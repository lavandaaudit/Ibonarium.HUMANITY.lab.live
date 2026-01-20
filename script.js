// Ibonarium Humanity Layer Script v6.0 - FULL ANALYTICS + LIVE GDELT
/**
 * Ця версія поєднує:
 * 1. Реальні дані Світового Банку (профілі країн)
 * 2. Живий потік новин GDELT (з пульсацією на карті)
 * 3. Історичні графіки трендів ВВП
 */

const mapConfig = { center: [20, 0], zoom: 2.5, minZoom: 2, maxZoom: 10 };

let map;
let countriesData = {}; 
let lookupTable = {};   
let activeLayer = 'humanity';
let markersLayer = L.layerGroup();
let pulseLayer = L.layerGroup();
let geoJsonLayer;

let globalStats = {
    population: 0, avgTension: 0.2, avgStability: 0.7, avgEconomy: 0.6, avgHealth: 0.7
};

const COLORS = {
    humanity: '#ffffff', demography: '#00f3ff', social: '#ff3333',     
    politics: '#ffaa00', economy: '#39ff14', health: '#ff00ff'      
};

const WB_INDICATORS = {
    growth: 'SP.POP.GROW',
    gdp_growth: 'NY.GDP.MKTP.KD.ZG',
    inflation: 'FP.CPI.TOTL.ZG',
    unemployment: 'SL.UEM.TOTL.ZS',
    life_expectancy: 'SP.DYN.LE00.IN'
};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initDataAndEvents();
    startClock();
});

function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView(mapConfig.center, mapConfig.zoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19
    }).addTo(map);

    markersLayer.addTo(map);
    pulseLayer.addTo(map);

    map.on('mousemove', (e) => {
        const lat = document.getElementById('lat');
        const lon = document.getElementById('lon');
        if (lat) lat.innerText = e.latlng.lat.toFixed(2);
        if (lon) lon.innerText = e.latlng.lng.toFixed(2);
    });
}

async function initDataAndEvents() {
    try {
        updateStatus('Синхронізація REST Countries...');
        const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,cca3,region,population,latlng,flags');
        const rawData = await response.json();

        updateStatus('Завантаження геометрій...');
        const geoResponse = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
        const geoData = await geoResponse.json();

        rawData.forEach(c => {
            if (!c.cca2) return;
            countriesData[c.cca2] = { ...c, stats: modelCountryBase(c), wb: {} };
            lookupTable[c.cca2] = c.cca2;
            if (c.cca3) lookupTable[c.cca3] = c.cca2;
            globalStats.population += (c.population || 0);
        });

        renderGeoJSONLayer(geoData);
        renderMarkers();
        updateGlobalDashboard();
        
        updateStatus('Система ONLINE. Потік активовано.');
        startEventFeed();

    } catch (e) {
        updateStatus('Помилка ініціалізації API.');
    }
}

function modelCountryBase(country) {
    return {
        tension: 0.1 + Math.random() * 0.2,
        stability: 0.6 + Math.random() * 0.3,
        pulse: 0.5 + Math.random() * 0.4
    };
}

// --- GDELT Live & Pulses ---

function triggerMapPulse(latlng, color = 'var(--accent-cyan)') {
    if (!latlng) return;
    const pulse = L.circleMarker(latlng, { radius: 5, color: color, fillOpacity: 0.8 }).addTo(pulseLayer);
    let s = 5, o = 1;
    const i = setInterval(() => {
        s += 2; o -= 0.05;
        pulse.setRadius(s);
        pulse.setStyle({ opacity: o, fillOpacity: o * 0.5 });
        if (o <= 0) { clearInterval(i); pulseLayer.removeLayer(pulse); }
    }, 50);
}

async function fetchGDELT(query = 'humanity', count = 5) {
    try {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&maxrecords=${count}&format=json`;
        const res = await fetch(url);
        const data = await res.json();
        return data.articles || [];
    } catch (e) { return []; }
}

async function startEventFeed() {
    const feed = document.getElementById('alert-feed');
    async function updateFeed() {
        const articles = await fetchGDELT('diplomacy OR crisis OR economy');
        articles.forEach(art => {
            const item = document.createElement('div');
            item.className = 'alert-item';
            item.innerHTML = `<span style="color:var(--accent-cyan)">[LIVE]</span> ${art.title.substring(0, 50)}...`;
            item.onclick = () => window.open(art.url, '_blank');
            feed.prepend(item);
            
            const keys = Object.keys(countriesData);
            const rc = countriesData[keys[Math.floor(Math.random() * keys.length)]];
            if (rc.latlng) triggerMapPulse(rc.latlng);
        });
        while (feed.children.length > 15) feed.lastChild.remove();
    }
    setInterval(updateFeed, 20000);
    updateFeed();
}

// --- Historical Data ---

async function fetchHistoricalData(code) {
    try {
        const url = `https://api.worldbank.org/v2/country/${code}/indicator/${WB_INDICATORS.gdp_growth}?format=json&date=2014:2024`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data[1]) {
            return {
                vals: data[1].map(i => i.value).reverse(),
                labels: data[1].map(i => i.date).reverse()
            };
        }
    } catch (e) { return null; }
    return null;
}

// --- Main Panel ---

async function openCountryInfo(country) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content-body');
    panel.classList.remove('hidden');
    content.innerHTML = `<div class="loading-spinner">СИНХРОНІЗАЦІЯ ДАНИХ ТА НОВИН...</div>`;
    
    map.flyTo(country.latlng, 5, { duration: 1.2 });

    // 1. Fetch WB Data (Real-time indicators)
    const wbCodes = Object.values(WB_INDICATORS).join(';');
    const wbUrl = `https://api.worldbank.org/v2/country/${country.cca2}/indicator/${wbCodes}?format=json&mrv=1`;
    
    // 2. Fetch GDELT News
    const [wbRes, news, history] = await Promise.all([
        fetch(wbUrl).then(r => r.json()),
        fetchGDELT(country.name.common + ' news', 3),
        fetchHistoricalData(country.cca2)
    ]);

    if (wbRes && wbRes[1]) {
        wbRes[1].forEach(item => {
            const key = Object.keys(WB_INDICATORS).find(k => WB_INDICATORS[k] === item.indicator.id);
            if (key) country.wb[key] = item.value;
        });
    }

    const { wb, stats: s } = country;
    const nf = (v, suffix = '%') => (v !== null && v !== undefined) ? parseFloat(v).toFixed(1) + suffix : 'N/A';

    content.innerHTML = `
        <div class="country-header" style="display:flex; align-items:center; gap:15px; margin-bottom:15px;">
            <img src="${country.flags.svg}" style="width:50px; border-radius:3px;">
            <div>
                <h2 style="margin:0; color:var(--accent-cyan); font-size:1.2rem;">${country.name.common.toUpperCase()}</h2>
                <div style="font-size:0.65rem; opacity:0.6;">POP: ${formatPopulation(country.population)}</div>
            </div>
        </div>

        <div style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:4px;">
                <span>CIVILIZATION STABILITY INDEX</span>
                <b style="color:var(--accent-green)">${(s.stability * 100).toFixed(0)}%</b>
            </div>
            <div style="height:4px; background:rgba(255,255,255,0.1); border-radius:2px;">
                <div style="width:${s.stability * 100}%; background:var(--accent-green); height:100%; box-shadow:0 0 10px var(--accent-green);"></div>
            </div>
        </div>

        <div class="control-group-title">АНАЛІТИКА СВІТОВОГО БАНКУ</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:15px;">
            <div class="vector-item" style="background:rgba(255,255,255,0.03); padding:8px; border-radius:4px;">
                <span style="font-size:0.6rem; color:var(--accent-green); display:block;">РІСТ ВВП</span>
                <b style="font-size:0.9rem;">${nf(wb.gdp_growth)}</b>
            </div>
            <div class="vector-item" style="background:rgba(255,255,255,0.03); padding:8px; border-radius:4px;">
                <span style="font-size:0.6rem; color:var(--accent-green); display:block;">ІНФЛЯЦІЯ</span>
                <b style="font-size:0.9rem;">${nf(wb.inflation)}</b>
            </div>
            <div class="vector-item" style="background:rgba(255,255,255,0.03); padding:8px; border-radius:4px;">
                <span style="font-size:0.6rem; color:var(--accent-magenta); display:block;">БЕЗРОБІТТЯ</span>
                <b style="font-size:0.9rem;">${nf(wb.unemployment)}</b>
            </div>
            <div class="vector-item" style="background:rgba(255,255,255,0.03); padding:8px; border-radius:4px;">
                <span style="font-size:0.6rem; color:var(--accent-magenta); display:block;">ЖИТТЄВИЙ ЦИКЛ</span>
                <b style="font-size:0.9rem;">${nf(wb.life_expectancy, 'р.')}</b>
            </div>
        </div>

        <div class="control-group-title">LIVE EVENTS (GDELT)</div>
        <div style="margin-bottom:15px;">
            ${news.map(n => `<div class="alert-item" style="font-size:0.65rem; margin-bottom:4px; padding:5px; border-left:2px solid var(--accent-cyan); background:rgba(0,243,255,0.05);" onclick="window.open('${n.url}')">${n.title}...</div>`).join('')}
            ${news.length === 0 ? '<div style="font-size:0.65rem; opacity:0.5;">Немає активних подій для регіону.</div>' : ''}
        </div>

        <div class="control-group-title">GDP GROWTH TREND (10Y)</div>
        <div style="height:100px; background:rgba(0,0,0,0.2); border-radius:4px; padding:5px;">
            <canvas id="historyChart"></canvas>
        </div>
    `;

    if (history) {
        const ctx = document.getElementById('historyChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: history.labels,
                datasets: [{ data: history.vals, borderColor: '#39ff14', borderWidth: 2, tension: 0.4, pointRadius: 0, fill: false }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: false }, scales: { x: { display: false }, y: { ticks: { color: '#666', font: { size: 7 } } } } }
        });
    }
    triggerMapPulse(country.latlng, 'var(--accent-cyan)');
}

// --- Core Utils ---

function renderGeoJSONLayer(geoData) {
    if (geoJsonLayer) map.removeLayer(geoJsonLayer);
    geoJsonLayer = L.geoJSON(geoData, {
        style: (f) => {
            const country = getCountry(f.properties['ISO3166-1-Alpha-2'] || f.id);
            return {
                fillColor: getColorForLayer(activeLayer, country),
                weight: 1, color: '#00f3ff', opacity: 0.3, fillOpacity: country ? 0.2 : 0.05
            };
        },
        onEachFeature: (f, l) => {
            const c = getCountry(f.properties['ISO3166-1-Alpha-2'] || f.id);
            if (c) l.on('click', (e) => { L.DomEvent.stopPropagation(e); openCountryInfo(c); });
        }
    }).addTo(map);
}

function renderMarkers() {
    markersLayer.clearLayers();
    Object.values(countriesData).forEach(c => {
        if (!c.latlng) return;
        L.circleMarker(c.latlng, {
            radius: Math.max(3, Math.sqrt(c.population)/3000), 
            fillColor: getColorForLayer(activeLayer, c), color: '#fff', weight: 0.5, opacity: 0.8, fillOpacity: 0.6
        }).on('click', (e) => { L.DomEvent.stopPropagation(e); openCountryInfo(c); }).addTo(markersLayer);
    });
}

function getCountry(code) {
    if (!code) return null;
    const key = lookupTable[code.toUpperCase()];
    return countriesData[key] || null;
}

function getColorForLayer(mode, c) {
    if (!c) return '#333';
    return c.stats.pulse > 0.7 ? COLORS.economy : c.stats.pulse < 0.4 ? COLORS.social : COLORS.politics;
}

function updateGlobalDashboard() {
    const el = document.getElementById('total-pop-display');
    if (el) el.innerText = formatPopulation(globalStats.population);
}

function updateStatus(m) {
    const el = document.getElementById('status-detailed');
    if (el) el.innerText = m;
}

function formatPopulation(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    return n.toLocaleString();
}

function startClock() {
    setInterval(() => {
        const el = document.getElementById('last-update');
        if (el) el.innerText = new Date().toLocaleTimeString();
    }, 1000);
}

function closeInfoPanel() { 
    document.getElementById('info-panel').classList.add('hidden'); 
}
