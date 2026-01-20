// Ibonarium Humanity Layer Script
// Real-time civilization monitoring with API integration

const mapConfig = {
    center: [20, 0],
    zoom: 2.5,
    minZoom: 2,
    maxZoom: 10
};

// Global State
let map;
let countriesData = {}; 
let lookupTable = {};   
let activeLayer = 'humanity';
let markersLayer = L.layerGroup();
let globalStats = {
    population: 0,
    avgTension: 0.5,
    avgStability: 0.5,
    avgEconomy: 0.5,
    avgHealth: 0.5,
    events_count: 0
};

let geoJsonLayer;

const COLORS = {
    humanity: '#ffffff',
    demography: '#00f3ff', 
    social: '#ff3333',     
    politics: '#ffaa00',   
    economy: '#39ff14',    
    health: '#ff00ff'      
};

const WB_INDICATORS = {
    growth: 'SP.POP.GROW',
    gdp_growth: 'NY.GDP.MKTP.KD.ZG',
    inflation: 'FP.CPI.TOTL.ZG',
    unemployment: 'SL.UEM.TOTL.ZS',
    life_expectancy: 'SP.DYN.LE00.IN',
};

const CLUSTERS = {
    'G7': ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'JP'],
    'BRICS': ['BR', 'RU', 'IN', 'CN', 'ZA', 'EG', 'ET', 'IR', 'AE', 'SA'],
    'EU': ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
    'ASEAN': ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN']
};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initDataAndEvents();
    startClock();
    initChart();
});

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView(mapConfig.center, mapConfig.zoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    L.control.scale({ position: 'bottomright' }).addTo(map);

    map.on('mousemove', (e) => {
        const latEl = document.getElementById('lat');
        const lonEl = document.getElementById('lon');
        if (latEl) latEl.innerText = e.latlng.lat.toFixed(2);
        if (lonEl) lonEl.innerText = e.latlng.lng.toFixed(2);
    });

    updateStatus('Завантаження систем...');
}

async function initDataAndEvents() {
    try {
        updateStatus('Синхронізація (REST Countries)...');
        const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,cca3,region,subregion,population,latlng,flags,capital,area');
        const rawData = await response.json();

        updateStatus('Отримання індикаторів (World Bank)...');
        await fetchGlobalWBStats();

        updateStatus('Мапування геоданих...');
        const geoResponse = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
        const geoData = await geoResponse.json();

        let totalPop = 0;
        rawData.forEach(c => {
            if (!c.cca2) return;
            const derivedStats = modelCountryStats(c);
            countriesData[c.cca2] = { ...c, stats: derivedStats, wb: {} };
            lookupTable[c.cca2] = c.cca2;
            if (c.cca3) lookupTable[c.cca3] = c.cca2;
            totalPop += (c.population || 0);
        });

        globalStats.population = totalPop;
        updateGlobalDashboard();
        
        renderGeoJSONLayer(geoData);
        renderMarkers();

        updateStatus('Система ONLINE. Потік активовано.');
        startEventFeed();

    } catch (e) {
        console.error('Init Error:', e);
        updateStatus('Помилка завантаження. Використовується кеш.');
        useFallbackData();
    }
}

function getCountry(code) {
    if (!code) return null;
    const key = lookupTable[code.toUpperCase()];
    return countriesData[key] || null;
}

async function fetchGlobalWBStats() {
    try {
        const indicators = [WB_INDICATORS.gdp_growth, WB_INDICATORS.life_expectancy];
        for (const id of indicators) {
            const url = `https://api.worldbank.org/v2/country/WLD/indicator/${id}?format=json&mrv=1`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data[1] && data[1][0]) {
                const val = data[1][0].value;
                if (id === WB_INDICATORS.gdp_growth) globalStats.avgEconomy = Math.min(1, Math.max(0, val / 10 + 0.5));
                if (id === WB_INDICATORS.life_expectancy) globalStats.avgHealth = Math.min(1, Math.max(0, val / 100));
            }
        }
    } catch (err) { console.warn('WB Global Error'); }
}

function renderGeoJSONLayer(geoData) {
    if (geoJsonLayer) map.removeLayer(geoJsonLayer);

    geoJsonLayer = L.geoJSON(geoData, {
        style: (feature) => {
            // FIX: Використання правильних ключів властивостей для цього GeoJSON
            const countryCode = feature.properties['ISO3166-1-Alpha-2'] || feature.properties.ISO_A2 || feature.id;
            const country = getCountry(countryCode);

            if (!country) return { fillColor: '#111', weight: 0.5, opacity: 0.1, color: '#333', fillOpacity: 0.05 };

            return {
                fillColor: getColorForLayer(activeLayer, country),
                weight: 1,
                opacity: 0.5,
                color: '#00f3ff',
                fillOpacity: getOpacityForLayer(activeLayer, country)
            };
        },
        onEachFeature: (feature, layer) => {
            const countryCode = feature.properties['ISO3166-1-Alpha-2'] || feature.properties.ISO_A2 || feature.id;
            const country = getCountry(countryCode);
            if (country) {
                layer.on({
                    click: (e) => { L.DomEvent.stopPropagation(e); openCountryInfo(country); },
                    mouseover: (e) => { e.target.setStyle({ weight: 2, color: '#fff', fillOpacity: 0.8 }); },
                    mouseout: (e) => { geoJsonLayer.resetStyle(e.target); }
                });
            }
        }
    }).addTo(map);
}

function modelCountryStats(country) {
    const region = country.region || 'World';
    let base = 0.5;
    if (region === 'Europe') base = 0.8;
    if (region === 'Africa') base = 0.3;
    
    return {
        tension: Math.random(),
        stability: base + (Math.random() * 0.2 - 0.1),
        economy: base + (Math.random() * 0.2 - 0.1),
        health: base + (Math.random() * 0.2 - 0.1),
        pulse: Math.random(),
        growthRate: (Math.random() - 0.5) * 0.02
    };
}

function renderMarkers() {
    markersLayer.clearLayers();
    Object.values(countriesData).forEach(country => {
        if (!country.latlng || country.latlng.length < 2) return;
        const color = getColorForLayer(activeLayer, country);
        const radius = getRadiusForLayer(activeLayer, country);

        L.circleMarker(country.latlng, {
            radius: radius,
            fillColor: color,
            color: '#fff',
            weight: 0.5,
            opacity: 0.8,
            fillOpacity: 0.6
        }).on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openCountryInfo(country);
        }).addTo(markersLayer);
    });
    markersLayer.addTo(map);
}

function getColorForLayer(mode, country) {
    const s = country.stats;
    if (mode === 'humanity') return s.pulse > 0.6 ? COLORS.economy : s.pulse < 0.4 ? COLORS.social : COLORS.politics;
    if (mode === 'demography') return COLORS.demography;
    if (mode === 'social') return COLORS.social;
    if (mode === 'politics') return COLORS.politics;
    if (mode === 'economy') return COLORS.economy;
    if (mode === 'health') return COLORS.health;
    return '#fff';
}

function getOpacityForLayer(mode, country) {
    return country.stats.stability || 0.6;
}

function getRadiusForLayer(mode, country) {
    const base = Math.sqrt(country.population || 1000) / 2500;
    return Math.max(3, Math.min(base, 20));
}

function toggleLayer(layerName) {
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`btn-${layerName}`);
    if (btn) btn.classList.add('active');
    activeLayer = layerName;

    if (geoJsonLayer) {
        geoJsonLayer.setStyle((feature) => {
            const countryCode = feature.properties['ISO3166-1-Alpha-2'] || feature.properties.ISO_A2 || feature.id;
            const country = getCountry(countryCode);
            if (!country) return { fillOpacity: 0.05 };
            return {
                fillColor: getColorForLayer(layerName, country),
                fillOpacity: getOpacityForLayer(layerName, country)
            };
        });
    }
    renderMarkers();
}

async function openCountryInfo(country) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content-body');
    if (!panel || !content) return;
    
    panel.classList.remove('hidden');
    content.innerHTML = `<div class="loading-spinner">ЗБІР ДАНИХ...</div>`;
    map.flyTo(country.latlng, 5);

    const s = country.stats;
    content.innerHTML = `
        <div class="country-header">
            <img src="${country.flags.svg}" class="flag-img" style="width:40px;">
            <div>
                <h3>${country.name.common}</h3>
                <p>${country.region}</p>
            </div>
        </div>
        <div class="vector-grid">
            <div class="vector-item"><span>PULSE</span><b>${(s.pulse * 100).toFixed(0)}%</b></div>
            <div class="vector-item"><span>POP</span><b>${formatPopulation(country.population)}</b></div>
        </div>
    `;
}

function closeInfoPanel() { 
    const p = document.getElementById('info-panel');
    if (p) p.classList.add('hidden'); 
}

function updateGlobalDashboard() {
    const popEl = document.getElementById('total-pop-display');
    if (popEl) popEl.innerText = formatPopulation(globalStats.population);
    
    const tensionEl = document.getElementById('global-tension');
    if (tensionEl) tensionEl.innerText = globalStats.avgTension.toFixed(2);
    
    const stressValEl = document.getElementById('stress-value');
    if (stressValEl) stressValEl.innerText = globalStats.avgTension.toFixed(2);
}

// --- GDELT Live Monitoring ---
async function startEventFeed() {
    const feed = document.getElementById('alert-feed');
    if (!feed) return;

    async function fetchGDELT() {
        try {
            updateStatus('GDELT: Пошук подій...');
            const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=humanity&mode=ArtList&maxrecords=5&format=json`;
            const res = await fetch(url);
            const data = await res.json();

            if (data && data.articles && data.articles.length > 0) {
                updateStatus('GDELT: Потік активний.');
                data.articles.forEach(art => {
                    const item = document.createElement('div');
                    item.className = 'alert-item';
                    item.innerHTML = `<span style="color:var(--accent-cyan)">[LIVE]</span> ${art.title.substring(0, 50)}...`;
                    item.onclick = () => window.open(art.url, '_blank');
                    feed.prepend(item);
                });
                if (feed.children.length > 15) feed.lastChild.remove();
            }
        } catch (e) {
            updateStatus('GDELT: Режим симуляції.');
        }
    }

    setInterval(fetchGDELT, 10000);
    fetchGDELT();
}

function updateStatus(msg) {
    const el = document.getElementById('status-detailed');
    if (el) el.innerText = msg;
}

function formatPopulation(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    return num.toLocaleString();
}

function startClock() {
    setInterval(() => {
        const el = document.getElementById('last-update');
        if (el) el.innerText = new Date().toLocaleTimeString();
    }, 1000);
}

function initChart() {
    // Basic pulse chart placeholder
}
