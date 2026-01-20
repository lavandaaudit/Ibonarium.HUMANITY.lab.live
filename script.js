// Ibonarium Humanity Layer Script v5.5 (Enhanced Interaction)

const mapConfig = {
    center: [20, 0], zoom: 2.5, minZoom: 2, maxZoom: 10
};

let map;
let countriesData = {}; 
let lookupTable = {};   
let activeLayer = 'humanity';
let markersLayer = L.layerGroup();
let pulseLayer = L.layerGroup(); // Новий шар для анімацій
let globalStats = {
    population: 0, avgTension: 0.24, avgStability: 0.72, avgEconomy: 0.65, avgHealth: 0.78
};

const COLORS = {
    humanity: '#ffffff', demography: '#00f3ff', social: '#ff3333',     
    politics: '#ffaa00', economy: '#39ff14', health: '#ff00ff'      
};

// --- DATA INITIALIZATION ---

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
        updateStatus('Синхронізація (REST Countries)...');
        const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,cca3,region,population,latlng,flags');
        const rawData = await response.json();

        const geoResponse = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
        const geoData = await geoResponse.json();

        rawData.forEach(c => {
            if (!c.cca2) return;
            countriesData[c.cca2] = { ...c, stats: modelCountryStats(c), events: [] };
            lookupTable[c.cca2] = c.cca2;
            if (c.cca3) lookupTable[c.cca3] = c.cca2;
            globalStats.population += (c.population || 0);
        });

        updateGlobalDashboard();
        renderGeoJSONLayer(geoData);
        renderMarkers();

        updateStatus('Система ONLINE. Потік активовано.');
        startEventFeed();

    } catch (e) {
        updateStatus('Помилка завантаження API.');
    }
}

function modelCountryStats(country) {
    const region = country.region || 'World';
    let base = region === 'Europe' ? 0.75 : region === 'Africa' ? 0.4 : 0.55;
    return {
        tension: 0.1 + Math.random() * 0.2,
        stability: base + (Math.random() * 0.1),
        economy: base + (Math.random() * 0.1),
        pulse: 0.6 + Math.random() * 0.3
    };
}

// --- VISUAL EFFECTS ---

function triggerMapPulse(latlng, color = 'var(--accent-cyan)') {
    if (!latlng || latlng.length < 2) return;
    
    const pulse = L.circleMarker(latlng, {
        radius: 5, fillColor: color, color: color, weight: 2, opacity: 1, fillOpacity: 0.8
    }).addTo(pulseLayer);

    let size = 5;
    let opacity = 1;
    
    const interval = setInterval(() => {
        size += 2;
        opacity -= 0.05;
        pulse.setRadius(size);
        pulse.setStyle({ opacity: opacity, fillOpacity: opacity * 0.5 });
        
        if (opacity <= 0) {
            clearInterval(interval);
            pulseLayer.removeLayer(pulse);
        }
    }, 50);
}

// --- GDELT INTEGRATION ---

async function fetchGDELT(query = 'humanity', isGlobal = true, countryCode = null) {
    try {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&maxrecords=5&format=json`;
        const res = await fetch(url);
        const data = await res.json();
        return data.articles || [];
    } catch (e) { return []; }
}

async function startEventFeed() {
    const feed = document.getElementById('alert-feed');
    if (!feed) return;

    async function processLiveStream() {
        const articles = await fetchGDELT('civilization OR crisis OR diplomacy');
        articles.forEach(art => {
            const item = document.createElement('div');
            item.className = 'alert-item';
            item.innerHTML = `<span style="color:var(--accent-cyan)">[LIVE]</span> ${art.title.substring(0, 55)}...`;
            item.onclick = () => window.open(art.url, '_blank');
            feed.prepend(item);

            // Візуальний імпульс у випадковій точці з реальних точок країн для ефекту "живої карти"
            const keys = Object.keys(countriesData);
            const randomCountry = countriesData[keys[Math.floor(Math.random() * keys.length)]];
            if (randomCountry.latlng) triggerMapPulse(randomCountry.latlng);
        });
        
        while (feed.children.length > 20) feed.lastChild.remove();
        updateGlobalDashboard();
    }

    setInterval(processLiveStream, 15000);
    processLiveStream();
}

// --- COUNTRY INFO PANEL (UPDATED) ---

async function openCountryInfo(country) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content-body');
    if (!panel || !content) return;
    
    panel.classList.remove('hidden');
    content.innerHTML = `<div class="loading-spinner">СИНХРОНІЗАЦІЯ З GDELT NETWORK...</div>`;
    map.flyTo(country.latlng, 5, { duration: 1.5 });

    // Отримання новин спеціально для цієї країни
    const countryNews = await fetchGDELT(country.name.common + ' news');

    const s = country.stats;
    let newsHtml = countryNews.length > 0 
        ? countryNews.map(n => `<div class="alert-item" style="font-size:0.7rem; padding:5px; border-left:2px solid var(--accent-cyan); margin-bottom:5px; background:rgba(0,243,255,0.05);" onclick="window.open('${n.url}')">
            ${n.title.substring(0, 70)}...
          </div>`).join('')
        : '<p style="color:var(--text-dim); font-size:0.7rem;">Поточних активних подій не виявлено.</p>';

    content.innerHTML = `
        <div class="country-header" style="display:flex; align-items:center; gap:15px; margin-bottom:20px;">
            <img src="${country.flags.svg}" style="width:60px; height:auto; border-radius:2px; box-shadow:0 0 10px rgba(0,0,0,0.5);">
            <div>
                <h2 style="color:var(--accent-cyan); margin:0; text-transform:uppercase;">${country.name.common}</h2>
                <span style="color:rgba(255,255,255,0.5); font-size:0.7rem;">GEOPOLITICAL ZONE: ${country.region}</span>
            </div>
        </div>

        <div class="control-group-title">LAYER DATA (REAL-TIME)</div>
        <div class="vector-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px;">
            <div class="vector-item" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:4px;">
                <span style="display:block; font-size:0.6rem; color:var(--text-dim);">PULSE</span>
                <b style="color:var(--accent-green); font-size:1.1rem;">${(s.pulse * 100).toFixed(0)}%</b>
            </div>
            <div class="vector-item" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:4px;">
                <span style="display:block; font-size:0.6rem; color:var(--text-dim);">POPULATION</span>
                <b style="color:var(--accent-cyan); font-size:1.1rem;">${formatPopulation(country.population)}</b>
            </div>
        </div>

        <div class="control-group-title">RECOGNIZED NEWS / EVENTS</div>
        <div class="events-container" style="max-height:200px; overflow-y:auto; padding-right:5px;">
            ${newsHtml}
        </div>

        <div style="margin-top:20px; font-size:0.6rem; color:var(--text-dim); text-align:center;">
            SOURCE: GDELT REAL-TIME STREAM v2.0
        </div>
    `;
    
    // Візуальний ефект при відкритті
    triggerMapPulse(country.latlng, 'var(--accent-cyan)');
}

// --- UTILS ---

function renderGeoJSONLayer(geoData) {
    if (geoJsonLayer) map.removeLayer(geoJsonLayer);
    geoJsonLayer = L.geoJSON(geoData, {
        style: (f) => ({
            fillColor: getColorForLayer(activeLayer, getCountry(f.properties['ISO3166-1-Alpha-2'] || f.id)),
            weight: 1, opacity: 0.3, color: '#00f3ff', fillOpacity: 0.15
        }),
        onEachFeature: (f, l) => {
            const c = getCountry(f.properties['ISO3166-1-Alpha-2'] || f.id);
            if (c) l.on('click', (e) => { L.DomEvent.stopPropagation(e); openCountryInfo(c); });
        }
    }).addTo(map);
}

function renderMarkers() {
    markersLayer.clearLayers();
    Object.values(countriesData).forEach(c => {
        if (!c.latlng || c.latlng.length < 2) return;
        L.circleMarker(c.latlng, {
            radius: Math.max(3, Math.sqrt(c.population)/3000), 
            fillColor: getColorForLayer(activeLayer, c), color: '#fff', weight: 0.5, opacity: 0.8, fillOpacity: 0.5
        }).on('click', (e) => { L.DomEvent.stopPropagation(e); openCountryInfo(c); }).addTo(markersLayer);
    });
}

function getColorForLayer(mode, c) {
    if (!c) return '#222';
    const s = c.stats;
    if (mode === 'humanity') return s.pulse > 0.7 ? '#39ff14' : s.pulse < 0.4 ? '#ff3333' : '#ffaa00';
    return COLORS[mode] || '#fff';
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
