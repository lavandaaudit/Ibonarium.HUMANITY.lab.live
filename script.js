// IBONARIUM HUMANITY LAYER - FULL PRO VERSION v8.0
// COMPLETE INTEGRATION: WB Analytics + GDELT Real-time + Pro Tools + Pulse Charts

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
let pulseLayer = L.layerGroup();
let geoJsonLayer;

let globalStats = {
    population: 0,
    avgTension: 0.35,
    avgStability: 0.65,
    avgEconomy: 0.55,
    avgHealth: 0.70,
    events_count: 0
};

// Theme Colors
const COLORS = {
    humanity: '#ffffff',
    demography: '#00f3ff',
    social: '#ff3333',
    politics: '#ffaa00',
    economy: '#39ff14',
    health: '#ff00ff'
};

// World Bank Indicators Mapping
const WB_INDICATORS = {
    growth: 'SP.POP.GROW',
    gdp_growth: 'NY.GDP.MKTP.KD.ZG',
    inflation: 'FP.CPI.TOTL.ZG',
    unemployment: 'SL.UEM.TOTL.ZS',
    life_expectancy: 'SP.DYN.LE00.IN'
};

// Professional Clusters
const CLUSTERS = {
    'G7': ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'JP'],
    'BRICS': ['BR', 'RU', 'IN', 'CN', 'ZA', 'EG', 'ET', 'IR', 'AE', 'SA'],
    'EU': ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
    'ASEAN': ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN']
};

// --- Initialization ---

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

    markersLayer.addTo(map);
    pulseLayer.addTo(map);

    map.on('mousemove', (e) => {
        const latEl = document.getElementById('lat');
        const lonEl = document.getElementById('lon');
        if (latEl) latEl.innerText = e.latlng.lat.toFixed(2);
        if (lonEl) lonEl.innerText = e.latlng.lng.toFixed(2);
    });

    updateStatus('Ініціалізація систем...');
}

async function initDataAndEvents() {
    try {
        updateStatus('Завантаження країн (REST Countries API)...');
        const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,cca3,region,subregion,population,latlng,flags,capital,area');
        const rawData = await response.json();

        updateStatus('Завантаження світових показників (World Bank)...');
        await fetchGlobalWBStats();

        updateStatus('Завантаження геометрії країн...');
        const geoResponse = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
        const geoData = await geoResponse.json();

        let totalPop = 0;
        rawData.forEach(c => {
            if (!c.cca2) return;
            countriesData[c.cca2] = {
                ...c,
                stats: modelCountryStats(c),
                wb: {}
            };
            lookupTable[c.cca2] = c.cca2;
            if (c.cca3) lookupTable[c.cca3] = c.cca2;
            totalPop += (c.population || 0);
        });

        globalStats.population = totalPop;

        updateGlobalDashboard();
        await prefetchMapData();
        renderGeoJSONLayer(geoData);
        renderMarkers();

        updateStatus('Система ONLINE. Моніторинг активний.');
        startEventFeed();

    } catch (e) {
        console.error('Core Init Error:', e);
        updateStatus('Помилка даних. Активація офлайн-протоколу.');
    }
}

// --- Data Modeling & Sync ---

function modelCountryStats(country) {
    const region = country.region || 'World';
    let stabilityBase = 0.6, economyBase = 0.5, freedomBase = 0.5;

    if (region === 'Europe') { stabilityBase = 0.8; economyBase = 0.7; freedomBase = 0.8; }
    else if (region === 'Africa') { stabilityBase = 0.4; economyBase = 0.3; freedomBase = 0.4; }

    return {
        tension: 1 - stabilityBase + (Math.random() * 0.2),
        stability: stabilityBase + (Math.random() * 0.2),
        economy: economyBase + (Math.random() * 0.2),
        regime: freedomBase + (Math.random() * 0.2),
        pulse: (stabilityBase + economyBase + (Math.random() * 0.2)) / 2
    };
}

async function fetchGlobalWBStats() {
    try {
        const indicators = [WB_INDICATORS.gdp_growth, WB_INDICATORS.life_expectancy, WB_INDICATORS.unemployment];
        for (const id of indicators) {
            const url = `https://api.worldbank.org/v2/country/WLD/indicator/${id}?format=json&mrv=1`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data[1] && data[1][0]) {
                const val = data[1][0].value;
                if (val !== null) {
                    if (id === WB_INDICATORS.gdp_growth) globalStats.avgEconomy = Math.min(1, Math.max(0, val / 10 + 0.5));
                    if (id === WB_INDICATORS.life_expectancy) globalStats.avgHealth = Math.min(1, Math.max(0, val / 100));
                    if (id === WB_INDICATORS.unemployment) globalStats.avgTension = Math.min(1, Math.max(0, val / 25));
                }
            }
        }
    } catch (err) { console.warn('WB Global Stats Error'); }
}

async function prefetchMapData() {
    try {
        updateStatus('Синхронізація глобальних шарів...');
        const indicators = {
            economy: WB_INDICATORS.gdp_growth,
            health: WB_INDICATORS.life_expectancy,
            social: WB_INDICATORS.unemployment
        };
        for (const [key, id] of Object.entries(indicators)) {
            const url = `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&mrv=1&per_page=300`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data[1]) {
                data[1].forEach(item => {
                    const country = getCountry(item.countryiso3code || item.country.id);
                    if (country) country.wb[key] = item.value;
                });
            }
        }
    } catch (err) { console.warn('Map Prefetch Error'); }
}

// --- Live Events & Pulses ---

function triggerMapPulse(latlng, color = '#00f3ff') {
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

async function startEventFeed() {
    const feed = document.getElementById('alert-feed');
    const EVENT_TYPES = ['PROTEST', 'DIPLOMACY', 'TRADE', 'CONFLICT', 'AID', 'HEALTH'];

    async function fetchGDELT() {
        try {
            const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=humanity OR civilization&mode=ArtList&maxrecords=3&format=json`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.articles) {
                data.articles.forEach(art => {
                    addFeedItem(`[LIVE] ${art.title.substring(0, 50)}...`, 'var(--accent-cyan)', () => window.open(art.url, '_blank'));
                    const keys = Object.keys(countriesData);
                    const rc = countriesData[keys[Math.floor(Math.random() * keys.length)]];
                    if (rc.latlng) triggerMapPulse(rc.latlng);
                });
            }
        } catch (e) { generateSimulatedEvent(); }
    }

    function generateSimulatedEvent() {
        const keys = Object.keys(countriesData);
        if (keys.length === 0) return;
        const country = countriesData[keys[Math.floor(Math.random() * keys.length)]];
        const type = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
        const time = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        let color = '#888';
        if (type === 'CONFLICT') color = COLORS.social;
        if (type === 'TRADE') color = COLORS.economy;
        addFeedItem(`${time} [${country.cca2}] ${type}: ${country.name.common}`, color);
        if (country.latlng) triggerMapPulse(country.latlng, color);
    }

    function addFeedItem(html, color, clickFn) {
        const item = document.createElement('div');
        item.className = 'alert-item';
        item.style.borderLeft = `2px solid ${color}`;
        item.innerHTML = html;
        if (clickFn) item.onclick = clickFn;
        feed.prepend(item);
        if (feed.children.length > 20) feed.lastChild.remove();
    }

    setInterval(() => { Math.random() > 0.4 ? fetchGDELT() : generateSimulatedEvent(); }, 12000);
    fetchGDELT();
}

// --- Country Info Panel ---

async function openCountryInfo(country) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content-body');
    panel.classList.remove('hidden');
    content.innerHTML = `<div class="loading-spinner">СИНХРОНІЗАЦІЯ ДАНИХ...</div>`;

    if (country.latlng) map.flyTo(country.latlng, 5, { duration: 1.5 });

    const wbCodes = Object.values(WB_INDICATORS).join(';');
    const wbUrl = `https://api.worldbank.org/v2/country/${country.cca2}/indicator/${wbCodes}?format=json&mrv=1`;

    const [wbRes, news, history] = await Promise.all([
        fetch(wbUrl).then(r => r.json()).catch(() => null),
        fetchGDELTProxy(country.name.common, 3),
        fetchHistoricalData(country.cca2)
    ]);

    if (wbRes && wbRes[1]) {
        wbRes[1].forEach(item => {
            const key = Object.keys(WB_INDICATORS).find(k => WB_INDICATORS[k] === item.indicator.id);
            if (key) country.wb[key] = item.value;
        });
    }

    const { stats: s, wb } = country;
    const nf = (v, suffix = '%') => (v !== null && v !== undefined) ? parseFloat(v).toFixed(2) + suffix : 'N/A';

    content.innerHTML = `
        <div class="country-header">
            <img src="${country.flags.svg}" class="flag-img" alt="flag">
            <div>
                <h2 style="color:var(--accent-cyan); margin:0; font-size:1.3rem;">${country.name.common.toUpperCase()}</h2>
                <span style="font-size:0.7rem; color:var(--text-dim);">${country.name.official}</span>
            </div>
        </div>

        <div style="margin:15px 0;">
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:5px;">
                <span>CIVILIZATION PULSE (STATE)</span>
                <b style="color:${getPulseColor(s.pulse)}">${(s.pulse * 100).toFixed(0)}%</b>
            </div>
            <div class="progress-bar" style="background:#111; height:6px;">
                <div style="width:${s.pulse * 100}%; background:${getPulseColor(s.pulse)}; height:100%; box-shadow:0 0 10px ${getPulseColor(s.pulse)};"></div>
            </div>
        </div>

        <div class="control-group-title">АНАЛІТИКА СВІТОВОГО БАНКУ</div>
        <div class="vector-grid">
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.economy}">РІСТ ВВП</span>
                <span class="vector-value">${nf(wb.gdp_growth)}</span>
            </div>
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.economy}">ІНФЛЯЦІЯ</span>
                <span class="vector-value">${nf(wb.inflation)}</span>
            </div>
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.social}">БЕЗРОБІТТЯ</span>
                <span class="vector-value">${nf(wb.unemployment)}</span>
            </div>
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.health}">ЖИТТЄВИЙ ЦИКЛ</span>
                <span class="vector-value">${nf(wb.life_expectancy, 'р.')}</span>
            </div>
        </div>

        <div class="control-group-title">СФЕРА: ПОЛІТИКА & ЛЮДИ</div>
        <div class="vector-grid">
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.politics}">СТАБІЛЬНІСТЬ</span>
                <span class="vector-value">${(s.stability * 10).toFixed(1)}/10</span>
            </div>
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.demography}">НАСЕЛЕННЯ</span>
                <span class="vector-value" style="font-size:0.9rem;">${formatPopulation(country.population)}</span>
            </div>
        </div>

        <div class="control-group-title" style="margin-top:15px;">LIVE CONTEXT (GDELT)</div>
        <div style="max-height:120px; overflow-y:auto;">
            ${news.map(n => `<div class="alert-item" style="font-size:0.65rem; margin-bottom:4px;" onclick="window.open('${n.url}')">${n.title}...</div>`).join('')}
        </div>

        <div class="control-group-title" style="margin-top:15px;">HISTORICAL ANALYTICS (10Y)</div>
        <div style="height:100px; background:rgba(0,0,0,0.2); border-radius:4px; margin-top:5px;">
            <canvas id="historyChart"></canvas>
        </div>
    `;

    if (history && history.vals.length > 0) {
        const ctx = document.getElementById('historyChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: history.labels,
                datasets: [{ data: history.vals, borderColor: COLORS.economy, borderWidth: 2, tension: 0.3, fill: false, pointRadius: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: false }, scales: { x: { display: false }, y: { ticks: { color: '#666', font: { size: 7 } } } } }
        });
    }
}

async function fetchGDELTProxy(query, count) {
    try {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&maxrecords=${count}&format=json`;
        const res = await fetch(url);
        const data = await res.json();
        return data.articles || [];
    } catch (e) { return []; }
}

async function fetchHistoricalData(code) {
    try {
        const url = `https://api.worldbank.org/v2/country/${code}/indicator/${WB_INDICATORS.gdp_growth}?format=json&date=2014:2024`;
        const res = await fetch(url).then(r => r.json());
        if (res && res[1]) {
            return { vals: res[1].map(i => i.value).reverse(), labels: res[1].map(i => i.date).reverse() };
        }
    } catch (e) { return null; }
}

// --- Professional Tools ---

async function viewCluster(name) {
    const members = CLUSTERS[name];
    updateStatus(`Аналіз кластера ${name}...`);
    geoJsonLayer.setStyle((f) => {
        const c = getCountry(f.properties['ISO3166-1-Alpha-2'] || f.id || f.properties.ISO_A2);
        const isMember = members.includes(c?.cca2);
        return { fillColor: isMember ? COLORS.economy : '#111', fillOpacity: isMember ? 0.7 : 0.1, weight: isMember ? 2 : 0.5, color: '#fff' };
    });
}

let correlationChartInstance;
function openCorrelationEngine() {
    const overlay = document.getElementById('correlation-overlay');
    overlay.classList.remove('hidden');
    const ctx = document.getElementById('correlationChart').getContext('2d');
    const dataPoints = Object.values(countriesData).filter(c => c.wb.economy !== undefined && c.wb.health !== undefined)
        .map(c => ({ x: c.wb.economy, y: c.wb.health, label: c.name.common }));
    if (correlationChartInstance) correlationChartInstance.destroy();
    correlationChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: [{ label: 'Global Assets Correlation', data: dataPoints, backgroundColor: 'rgba(0, 243, 255, 0.6)', borderColor: '#00f3ff' }] },
        options: { scales: { x: { title: { display: true, text: 'GDP Growth (%)' } }, y: { title: { display: true, text: 'Life Expectancy (y)' } } } }
    });
}

function closeCorrelationEngine() { document.getElementById('correlation-overlay').classList.add('hidden'); }

// --- Dashboard & Graphics ---

function updateGlobalDashboard() {
    animateValue('global-pop-display', 0, globalStats.population, 2000, formatPopulation);
    animateValue('total-pop-display', 0, globalStats.population, 2000, formatPopulation);

    setTimeout(() => {
        document.getElementById('global-tension').innerText = globalStats.avgTension.toFixed(2);
        document.getElementById('global-economy').innerText = globalStats.avgEconomy.toFixed(2);
        document.getElementById('global-health').innerText = globalStats.avgHealth.toFixed(2);

        const stressVal = globalStats.avgTension;
        document.getElementById('stress-value').innerText = stressVal.toFixed(2);
        document.getElementById('danger-progress').style.width = (stressVal * 100) + '%';

        const stressLabel = document.getElementById('stress-status');
        if (stressVal > 0.7) { stressLabel.innerText = 'CRITICAL'; stressLabel.style.color = 'var(--accent-red)'; }
        else if (stressVal > 0.4) { stressLabel.innerText = 'ELEVATED'; stressLabel.style.color = 'var(--accent-orange)'; }
        else { stressLabel.innerText = 'STABLE'; stressLabel.style.color = 'var(--accent-green)'; }
    }, 1000);
}

let pulseChart;
function initChart() {
    const ctx = document.getElementById('humanityChart');
    if (!ctx) return;
    pulseChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(20).fill(''),
            datasets: [{
                data: Array(20).fill(0).map(() => 0.5 + Math.random() * 0.2),
                borderColor: COLORS.politics,
                borderWidth: 2, tension: 0.4, pointRadius: 0, fill: true,
                backgroundColor: 'rgba(255, 170, 0, 0.1)'
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: false }, scales: { x: { display: false }, y: { display: false, min: 0, max: 1 } } }
    });
    setInterval(() => {
        pulseChart.data.datasets[0].data.shift();
        pulseChart.data.datasets[0].data.push(0.5 + Math.random() * 0.3);
        pulseChart.update('none');
    }, 3000);
}

// --- Map Layers ---

function renderGeoJSONLayer(geoData) {
    if (geoJsonLayer) map.removeLayer(geoJsonLayer);
    geoJsonLayer = L.geoJSON(geoData, {
        style: (f) => {
            const code = f.properties['ISO3166-1-Alpha-2'] || f.id || f.properties.ISO_A2;
            const c = getCountry(code);
            return { fillColor: getColorForLayer(activeLayer, c), weight: 1, color: '#00f3ff', opacity: 0.3, fillOpacity: c ? 0.2 : 0.05 };
        },
        onEachFeature: (f, l) => {
            const code = f.properties['ISO3166-1-Alpha-2'] || f.id || f.properties.ISO_A2;
            const c = getCountry(code);
            if (c) l.on('click', (e) => { L.DomEvent.stopPropagation(e); openCountryInfo(c); });
        }
    }).addTo(map);
}

function renderMarkers() {
    markersLayer.clearLayers();
    Object.values(countriesData).forEach(c => {
        if (!c.latlng) return;
        L.circleMarker(c.latlng, {
            radius: Math.max(3, Math.sqrt(c.population) / 3500),
            fillColor: getColorForLayer(activeLayer, c), color: '#fff', weight: 0.5, opacity: 0.7, fillOpacity: 0.6
        }).on('click', (e) => { L.DomEvent.stopPropagation(e); openCountryInfo(c); }).addTo(markersLayer);
    });
}

function toggleLayer(name) {
    activeLayer = name;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${name}`).classList.add('active');
    if (geoJsonLayer) geoJsonLayer.setStyle(f => ({ fillColor: getColorForLayer(activeLayer, getCountry(f.properties['ISO3166-1-Alpha-2'] || f.id || f.properties.ISO_A2)) }));
    renderMarkers();
}

// --- Utils ---

function getCountry(code) { return lookupTable[code?.toUpperCase()] ? countriesData[lookupTable[code.toUpperCase()]] : null; }
function getColorForLayer(mode, c) {
    if (!c) return '#222';
    if (mode === 'humanity') return c.stats.pulse > 0.7 ? COLORS.economy : c.stats.pulse < 0.4 ? COLORS.social : COLORS.politics;
    return COLORS[mode] || '#fff';
}
function getPulseColor(v) { return v > 0.7 ? COLORS.economy : v < 0.4 ? COLORS.social : COLORS.politics; }
function formatPopulation(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toString();
}
function animateValue(id, start, end, duration, formatter) {
    const obj = document.getElementById(id); if (!obj) return;
    let startT = null;
    const step = (t) => {
        if (!startT) startT = t;
        const progress = Math.min((t - startT) / duration, 1);
        const val = Math.floor(progress * (end - start) + start);
        obj.innerHTML = formatter ? formatter(val) : val;
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}
function updateStatus(m) { const el = document.getElementById('status-detailed'); if (el) el.innerText = m; }
function startClock() { setInterval(() => { const el = document.getElementById('last-update'); if (el) el.innerText = new Date().toLocaleTimeString('uk-UA'); }, 1000); }
function closeInfoPanel() { document.getElementById('info-panel').classList.add('hidden'); }
function toggleMobilePanel() { document.getElementById('controls').classList.toggle('collapsed'); }
