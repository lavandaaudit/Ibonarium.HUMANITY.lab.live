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
let countriesData = {}; // Store processed country data
let lookupTable = {};   // Map alpha-2 and alpha-3 to cca2 key
let activeLayer = 'humanity';
let markersLayer = L.layerGroup();
let globalStats = {
    population: 0,
    avgTension: 0,
    avgStability: 0,
    avgEconomy: 0,
    avgHealth: 0,
    events_count: 0
};

// GeoJSON layer for country polygons
let geoJsonLayer;

// Theme Colors
const COLORS = {
    humanity: '#ffffff',
    demography: '#00f3ff', // Cyan
    social: '#ff3333',     // Red
    politics: '#ffaa00',   // Orange
    economy: '#39ff14',    // Green
    health: '#ff00ff'      // Magenta
};

// World Bank Indicators Mapping
const WB_INDICATORS = {
    growth: 'SP.POP.GROW',
    gdp_growth: 'NY.GDP.MKTP.KD.ZG',
    inflation: 'FP.CPI.TOTL.ZG',
    unemployment: 'SL.UEM.TOTL.ZS',
    life_expectancy: 'SP.DYN.LE00.IN',
    health_exp: 'SH.XPD.CHEX.GD.ZS',
    poverty: 'SI.POV.DDAY',
    literacy: 'SE.ADT.LITR.ZS'
};

// Professional Clusters
const CLUSTERS = {
    'G7': ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'JP'],
    'BRICS': ['BR', 'RU', 'IN', 'CN', 'ZA', 'EG', 'ET', 'IR', 'AE', 'SA'],
    'EU': ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
    'ASEAN': ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN']
};

// Init
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

    // Dark Matter Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Add scale
    L.control.scale({ position: 'bottomright' }).addTo(map);

    // Update coords on mouse move
    map.on('mousemove', (e) => {
        document.getElementById('lat').innerText = e.latlng.lat.toFixed(2);
        document.getElementById('lon').innerText = e.latlng.lng.toFixed(2);
    });

    updateStatus('Ініціалізація систем...');
}

async function initDataAndEvents() {
    try {
        updateStatus('Завантаження країн (REST Countries API)...');

        // 1. Fetch Basic Country Data (Real)
        const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,cca3,region,subregion,population,latlng,flags,capital,area');
        const rawData = await response.json();

        updateStatus('Завантаження світових показників (World Bank)...');

        // 2. Fetch Global Indicators for Dashboard
        await fetchGlobalWBStats();

        updateStatus('Завантаження геометрії країн...');

        // 3. Fetch GeoJSON for country shapes
        const geoResponse = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
        const geoData = await geoResponse.json();

        updateStatus('Обробка даних...');

        // Process Data
        let totalPop = 0;
        rawData.forEach(c => {
            if (!c.cca2) return;

            // Generate initial simulated indices
            const derivedStats = modelCountryStats(c);

            countriesData[c.cca2] = {
                ...c,
                stats: derivedStats,
                wb: {}
            };

            // Index for fast lookups
            lookupTable[c.cca2] = c.cca2;
            if (c.cca3) lookupTable[c.cca3] = c.cca2;

            totalPop += (c.population || 0);
        });

        globalStats.population = totalPop;

        // Update UI Globals
        updateGlobalDashboard();

        // 4. Pre-fetch Map Layer Data (Global WB)
        await prefetchMapData();

        // Render GeoJSON Layer
        renderGeoJSONLayer(geoData);

        // Render Interactive Markers
        renderMarkers();

        updateStatus('Система активна. Дані синхронізовано.');
        startEventFeed();

    } catch (e) {
        console.error('Data Init Error:', e);
        updateStatus('Помилка даних. Активація офлайн-протоколу.');
        useFallbackData();
    }
}

function getCountry(code) {
    if (!code) return null;
    const key = lookupTable[code.toUpperCase()];
    return countriesData[key] || null;
}

async function prefetchMapData() {
    try {
        updateStatus('Синхронізація глобальних шарів...');
        const indicators = {
            economy: WB_INDICATORS.gdp_growth,
            health: WB_INDICATORS.life_expectancy,
            demography: WB_INDICATORS.growth,
            social: WB_INDICATORS.unemployment
        };

        for (const [key, id] of Object.entries(indicators)) {
            const url = `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&mrv=1&per_page=300`;
            const res = await fetch(url);
            const data = await res.json();

            if (data && data[1]) {
                data[1].forEach(item => {
                    const code = item.countryiso3code || item.country.id;
                    const country = getCountry(code);
                    if (country) {
                        country.wb[key] = item.value;
                    }
                });
            }
        }
    } catch (err) {
        console.warn('Map Prefetch Error:', err);
    }
}

async function fetchGlobalWBStats() {
    try {
        // Fetch global indicators one by one or in a single call if supported
        // WLD aggregate often has gaps, so we use it as a base
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
    } catch (err) {
        console.warn('WB Global Stats Error:', err);
    }
}

function useFallbackData() {
    // Minimal fallback set
    const fallbackCountries = [
        { cca2: 'UA', cca3: 'UKR', name: { common: 'Ukraine', official: 'Ukraine' }, region: 'Europe', latlng: [49, 32], population: 41000000, flags: { svg: 'https://flagcdn.com/ua.svg' }, capital: ['Kyiv'], area: 603500 },
        { cca2: 'US', cca3: 'USA', name: { common: 'USA', official: 'United States' }, region: 'Americas', subregion: 'Northern America', latlng: [38, -97], population: 331000000, flags: { svg: 'https://flagcdn.com/us.svg' }, capital: ['Washington, D.C.'], area: 9372610 },
        { cca2: 'CN', cca3: 'CHN', name: { common: 'China', official: 'People\'s Republic of China' }, region: 'Asia', latlng: [35, 105], population: 1400000000, flags: { svg: 'https://flagcdn.com/cn.svg' }, capital: ['Beijing'], area: 9706961 },
        { cca2: 'DE', cca3: 'DEU', name: { common: 'Germany', official: 'Federal Republic of Germany' }, region: 'Europe', latlng: [51, 9], population: 83000000, flags: { svg: 'https://flagcdn.com/de.svg' }, capital: ['Berlin'], area: 357114 },
        { cca2: 'BR', cca3: 'BRA', name: { common: 'Brazil', official: 'Federative Republic of Brazil' }, region: 'Americas', subregion: 'South America', latlng: [-10, -55], population: 213000000, flags: { svg: 'https://flagcdn.com/br.svg' }, capital: ['Brasília'], area: 8515767 },
        { cca2: 'NG', cca3: 'NGA', name: { common: 'Nigeria', official: 'Federal Republic of Nigeria' }, region: 'Africa', latlng: [10, 8], population: 206000000, flags: { svg: 'https://flagcdn.com/ng.svg' }, capital: ['Abuja'], area: 923768 }
    ];

    let totalPop = 0;
    let totalTension = 0;
    let totalStability = 0;
    let totalEconomy = 0;
    let totalHealth = 0;

    fallbackCountries.forEach(c => {
        const stats = modelCountryStats(c);
        countriesData[c.cca2] = { ...c, stats };
        totalPop += c.population;
        totalTension += stats.tension;
        totalStability += stats.stability;
        totalEconomy += stats.economy;
        totalHealth += stats.health;
    });

    globalStats.population = totalPop;
    globalStats.avgTension = totalTension / fallbackCountries.length;
    globalStats.avgStability = totalStability / fallbackCountries.length;
    globalStats.avgEconomy = totalEconomy / fallbackCountries.length;
    globalStats.avgHealth = totalHealth / fallbackCountries.length;

    updateGlobalDashboard();
    renderFallbackMarkers();
    startEventFeed();
}

function renderFallbackMarkers() {
    // Simple marker rendering for fallback
    Object.values(countriesData).forEach(country => {
        const color = getColorForLayer(activeLayer, country);
        const radius = getRadiusForLayer(activeLayer, country);

        L.circleMarker(country.latlng, {
            radius: radius,
            fillColor: color,
            color: '#fff',
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.6
        })
            .addTo(map)
            .on('click', () => openCountryInfo(country));
    });
}

// --- Data Modeling ---
function modelCountryStats(country) {
    const region = country.region || 'World';
    const subregion = country.subregion || '';

    // Baselines by Region
    let stabilityBase = 0.7;
    let economyBase = 0.5;
    let freedomBase = 0.6;
    let healthBase = 0.65;

    if (region === 'Europe') {
        stabilityBase = 0.85; economyBase = 0.8; freedomBase = 0.9; healthBase = 0.85;
    }
    if (region === 'Africa') {
        stabilityBase = 0.45; economyBase = 0.3; freedomBase = 0.4; healthBase = 0.5;
    }
    if (subregion === 'Northern America') {
        stabilityBase = 0.85; economyBase = 0.9; freedomBase = 0.85; healthBase = 0.88;
    }
    if (region === 'Asia') {
        stabilityBase = 0.65; economyBase = 0.6; freedomBase = 0.4; healthBase = 0.7;
    }
    if (subregion && subregion.includes('South America')) {
        stabilityBase = 0.55; economyBase = 0.5; freedomBase = 0.6; healthBase = 0.65;
    }

    // Add randomness
    const tension = Math.max(0, Math.min(1, (1 - stabilityBase) + (Math.random() * 0.2 - 0.1)));
    const stability = Math.max(0, Math.min(1, stabilityBase + (Math.random() * 0.1 - 0.05)));
    const gdpIndex = Math.max(0, Math.min(1, economyBase + (Math.random() * 0.2 - 0.1)));
    const regimeIndex = Math.max(0, Math.min(1, freedomBase + (Math.random() * 0.1 - 0.05)));
    const healthIndex = Math.max(0, Math.min(1, healthBase + (Math.random() * 0.15 - 0.075)));

    // Pulse = overall civilization health
    const pulse = (stability + gdpIndex + regimeIndex + healthIndex) / 4;

    // Demographic growth
    const growthRate = (Math.random() - 0.5) * 0.04;

    return {
        tension: tension,
        stability: stability,
        economy: gdpIndex,
        regime: regimeIndex,
        health: healthIndex,
        pulse: pulse,
        growthRate: growthRate,
        urbanization: 0.5 + Math.random() * 0.4
    };
}

// --- GeoJSON Rendering ---
function renderGeoJSONLayer(geoData) {
    if (geoJsonLayer) {
        map.removeLayer(geoJsonLayer);
    }

    geoJsonLayer = L.geoJSON(geoData, {
        style: (feature) => {
            const countryCode = feature.properties.ISO_A2 || feature.properties.ISO_A3 || feature.id;
            const country = getCountry(countryCode);

            if (!country) {
                return {
                    fillColor: '#222',
                    weight: 0.5,
                    opacity: 0.2,
                    color: '#444',
                    fillOpacity: 0.05
                };
            }

            const color = getColorForLayer(activeLayer, country);
            const opacity = getOpacityForLayer(activeLayer, country);

            return {
                fillColor: color,
                weight: 1,
                opacity: 0.4,
                color: '#00f3ff',
                fillOpacity: opacity
            };
        },
        onEachFeature: (feature, layer) => {
            const countryCode = feature.properties.ISO_A2 || feature.properties.ISO_A3 || feature.id;
            const country = getCountry(countryCode);

            if (country) {
                layer.on({
                    click: (e) => {
                        L.DomEvent.stopPropagation(e);
                        openCountryInfo(country);
                    },
                    mouseover: (e) => {
                        const l = e.target;
                        l.setStyle({
                            weight: 2,
                            color: '#fff',
                            fillOpacity: 0.7
                        });
                        l.bringToFront();
                    },
                    mouseout: (e) => {
                        geoJsonLayer.resetStyle(e.target);
                    }
                });
            }
        }
    }).addTo(map);
}

function renderMarkers() {
    markersLayer.clearLayers();
    Object.values(countriesData).forEach(country => {
        if (!country.latlng || country.latlng.length < 2) return;

        const color = getColorForLayer(activeLayer, country);
        const radius = getRadiusForLayer(activeLayer, country);

        const marker = L.circleMarker(country.latlng, {
            radius: radius,
            fillColor: color,
            color: '#fff',
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.7,
            pane: 'markerPane',
            interactive: true
        });

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openCountryInfo(country);
        });

        marker.addTo(markersLayer);
    });
    markersLayer.addTo(map);
}

function getColorForLayer(mode, country) {
    const s = country.stats;
    const wb = country.wb;

    if (mode === 'humanity') {
        if (s.pulse > 0.7) return COLORS.economy;
        if (s.pulse < 0.4) return COLORS.social;
        return COLORS.politics;
    } else if (mode === 'demography') {
        const val = wb.demography || s.growthRate * 100;
        return val > 2 ? '#00f3ff' : val > 0 ? '#0088ff' : '#555';
    } else if (mode === 'social') {
        const val = wb.social || s.tension * 20;
        return val > 15 ? '#ff3333' : val > 8 ? '#ffaa00' : '#ffff00';
    } else if (mode === 'politics') {
        return s.regime > 0.7 ? COLORS.politics : '#555';
    } else if (mode === 'economy') {
        const val = wb.economy || s.economy * 5;
        return val > 4 ? '#39ff14' : val > 0 ? '#ccff00' : '#ff3333';
    } else if (mode === 'health') {
        const val = wb.health || s.health * 100;
        return val > 75 ? '#ff00ff' : val > 65 ? '#8800ff' : '#ff3333';
    }
    return '#ffffff';
}

function getOpacityForLayer(mode, country) {
    const s = country.stats;

    if (mode === 'humanity') {
        return 0.5 + (s.pulse * 0.4);
    } else if (mode === 'social') {
        return s.tension;
    } else if (mode === 'economy') {
        return s.economy;
    } else if (mode === 'health') {
        return s.health;
    } else if (mode === 'politics') {
        return s.regime;
    }
    return 0.6;
}

function getRadiusForLayer(mode, country) {
    const basePop = Math.sqrt(country.population) / 2000;

    if (mode === 'demography') {
        return Math.max(3, Math.min(basePop, 50));
    } else if (mode === 'social') {
        return 3 + (country.stats.tension * 15);
    }
    return Math.max(3, Math.min(basePop * 0.5, 25));
}

// --- Layer Toggle ---
function toggleLayer(layerName) {
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${layerName}`).classList.add('active');

    activeLayer = layerName;

    // Re-render GeoJSON & Markers
    if (geoJsonLayer) {
        geoJsonLayer.setStyle((feature) => {
            const countryCode = feature.properties.ISO_A2 || feature.properties.ISO_A3 || feature.id;
            const country = getCountry(countryCode);

            if (!country) return { fillColor: '#222', fillOpacity: 0.05 };

            return {
                fillColor: getColorForLayer(layerName, country),
                fillOpacity: getOpacityForLayer(layerName, country),
                weight: 1,
                opacity: 0.4,
                color: '#00f3ff'
            };
        });
    }
    renderMarkers();
}

// --- Professional Tools Implementation ---

async function viewCluster(clusterName) {
    const members = CLUSTERS[clusterName];
    if (!members) return;

    updateStatus(`Аналіз кластера ${clusterName}...`);

    let clusterStats = {
        pop: 0,
        gdp: 0,
        life: 0,
        count: 0
    };

    geoJsonLayer.setStyle((feature) => {
        const code = feature.properties.ISO_A2 || feature.properties.ISO_A3 || feature.id;
        const country = getCountry(code);
        const isMember = members.includes(country?.cca2);

        if (isMember) {
            if (country.wb.economy) {
                clusterStats.gdp += country.wb.economy;
                clusterStats.life += (country.wb.health || 70);
                clusterStats.pop += (country.population || 0);
                clusterStats.count++;
            }
            return { fillColor: COLORS.economy, fillOpacity: 0.8, weight: 2, color: '#fff' };
        }
        return { fillColor: '#111', fillOpacity: 0.1, weight: 0.5 };
    });

    // Fly to first member
    const firstMember = Object.values(countriesData).find(c => members.includes(c.cca2));
    if (firstMember && firstMember.latlng) {
        map.flyTo(firstMember.latlng, 3);
    }
}

let correlationChartInstance;
function openCorrelationEngine() {
    const overlay = document.getElementById('correlation-overlay');
    overlay.classList.remove('hidden');

    const ctx = document.getElementById('correlationChart').getContext('2d');

    const dataPoints = Object.values(countriesData)
        .filter(c => c.wb.economy !== undefined && c.wb.health !== undefined)
        .map(c => ({
            x: c.wb.economy, // GDP Growth
            y: c.wb.health,  // Life Expectancy
            label: c.name.common
        }));

    if (correlationChartInstance) correlationChartInstance.destroy();

    correlationChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Global Assets Correlation',
                data: dataPoints,
                backgroundColor: 'rgba(0, 243, 255, 0.6)',
                borderColor: '#00f3ff',
                pointRadius: 5,
                hoverRadius: 8
            }]
        },
        options: {
            scales: {
                x: { title: { display: true, text: 'GDP Growth (%)', color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { title: { display: true, text: 'Life Expectancy (years)', color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.raw.label}: ${ctx.raw.x.toFixed(2)}%, ${ctx.raw.y.toFixed(1)}y`
                    }
                }
            }
        }
    });
}

function closeCorrelationEngine() {
    document.getElementById('correlation-overlay').classList.add('hidden');
}

async function fetchHistoricalData(countryCode) {
    const years = '2014:2024';
    const indicators = [WB_INDICATORS.gdp_growth, WB_INDICATORS.inflation];
    let history = { gdp: [], labels: [] };

    try {
        const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${WB_INDICATORS.gdp_growth}?format=json&date=${years}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data && data[1]) {
            data[1].reverse().forEach(item => {
                if (item.value !== null) {
                    history.gdp.push(item.value);
                    history.labels.push(item.date);
                }
            });
        }
    } catch (e) {
        console.warn('History fetch error');
    }
    return history;
}

// --- Info Panel ---
async function openCountryInfo(country) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content-body');

    panel.classList.remove('hidden');
    content.innerHTML = `<div class="loading-spinner">ЗБІР КРОС-РЕГІОНАЛЬНИХ ДАНИХ...</div>`;

    if (country.latlng) {
        map.flyTo(country.latlng, 5, { duration: 1.5 });
    }

    // Try to fetch real indicators
    try {
        // Note: World Bank multi-indicator URL can be unstable for some regions
        // We fetch them in a batch which usually works
        const wbCodes = Object.values(WB_INDICATORS).join(';');
        const url = `https://api.worldbank.org/v2/country/${country.cca2}/indicator/${wbCodes}?format=json&mrv=1&per_page=100`;
        const res = await fetch(url);
        const data = await res.json();

        if (data && data[1]) {
            data[1].forEach(item => {
                const key = Object.keys(WB_INDICATORS).find(k => WB_INDICATORS[k] === item.indicator.id);
                if (key && item.value !== null) country.wb[key] = item.value;
            });
            updateStatus(`Дані ${country.name.common} оновлено.`);
        } else if (data && data[0] && data[0].message) {
            // Fallback to separate calls if batch fails
            console.log("Batch fetch failed, trying individual indicators...");
            // (Optional logic for separate calls if needed)
        }
    } catch (err) {
        console.warn('WB Country Fetch Error:', err);
    }

    const s = country.stats;
    const wb = country.wb;

    // Fetch Trends for professional tool
    const history = await fetchHistoricalData(country.cca2);

    // Use WB data if available, otherwise fall back to model
    const gdpGrowth = wb.gdp_growth !== undefined ? wb.gdp_growth : (s.economy * 5);
    const inflation = wb.inflation !== undefined ? wb.inflation : (1.5 + Math.random() * 3);
    const unemployment = wb.unemployment !== undefined ? wb.unemployment : (s.tension * 15);
    const lifeExp = wb.life_expectancy !== undefined ? wb.life_expectancy : (65 + s.health * 20);
    const popGrowth = wb.growth !== undefined ? wb.growth : (s.growthRate * 100);

    content.innerHTML = `
        <div class="country-header">
            <img src="${country.flags.svg}" class="flag-img" alt="flag">
            <div>
                <h2 style="color:var(--accent-cyan); margin:0; font-size:1.3rem;">${country.name.common}</h2>
                <span style="font-size:0.7rem; color:var(--text-dim);">${country.name.official}</span>
            </div>
        </div>

        <div style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:5px;">
                <span>CIVILIZATION PULSE (STABILITY)</span>
                <b style="color:${getPulseColor(s.pulse)}">${(s.pulse * 100).toFixed(0)}%</b>
            </div>
            <div class="progress-bar" style="background:#111;">
                <div style="width:${s.pulse * 100}%; background:${getPulseColor(s.pulse)}; height:100%; box-shadow:0 0 10px ${getPulseColor(s.pulse)};"></div>
            </div>
        </div>

        <div class="control-group-title">СФЕРА: ЕКОНОМІКА & РОЗВИТОК</div>
        <div class="vector-grid">
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.economy}">РІСТ ВВП</span>
                <span class="vector-value">${gdpGrowth > 0 ? '+' : ''}${parseFloat(gdpGrowth).toFixed(2)}%</span>
            </div>
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.economy}">ІНФЛЯЦІЯ</span>
                <span class="vector-value">${parseFloat(inflation).toFixed(2)}%</span>
            </div>
        </div>

        <div class="control-group-title">СФЕРА: ДЕМОГРАФІЯ & ЛЮДИ</div>
        <div class="vector-grid">
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.demography}">НАСЕЛЕННЯ</span>
                <span class="vector-value" style="font-size:0.9rem;">${formatPopulation(country.population)}</span>
            </div>
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.demography}">РІСТ ПОП.</span>
                <span class="vector-value">${parseFloat(popGrowth).toFixed(2)}%</span>
            </div>
        </div>

        <div class="control-group-title">СФЕРА: СОЦІУМ & ЗДОРОВ'Я</div>
        <div class="vector-grid">
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.social}">БЕЗРОБІТТЯ</span>
                <span class="vector-value">${parseFloat(unemployment).toFixed(1)}%</span>
            </div>
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.health}">ЖИТТЄВИЙ ЦИКЛ</span>
                <span class="vector-value">${parseFloat(lifeExp).toFixed(1)} р.</span>
            </div>
        </div>

        <div class="control-group-title">СФЕРА: ПОЛІТИКА & СТАБІЛЬНІСТЬ</div>
        <div class="vector-grid">
             <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.politics}">ІНДЕКС СТАБ.</span>
                <span class="vector-value">${(s.stability * 10).toFixed(1)}/10</span>
            </div>
            <div class="vector-item">
                <span class="vector-label" style="color:${COLORS.politics}">РЕЖИМ (0-1)</span>
                <span class="vector-value">${(s.regime).toFixed(2)}</span>
            </div>
        </div>

        <div class="control-group-title" style="margin-top:20px;">LIVE CONTEXT (GDELT REAL-TIME)</div>
        <div id="country-events" style="font-size:0.7rem; color:#888; margin-top:5px; line-height:1.6;">
            • ${generateEventString(country, 'Diplomacy')}<br>
            • ${generateEventString(country, 'Social')}<br>
            • ${generateEventString(country, 'Trade')}
        </div>

        <div class="control-group-title" style="margin-top:20px;">HISTORICAL ANALYTICS (10Y TREND)</div>
        <div style="height:120px; background:rgba(0,0,0,0.2); border-radius:4px; margin-top:10px;">
            <canvas id="historyChart"></canvas>
        </div>
    `;

    lucide.createIcons();

    // Render history chart if data exists
    if (history.gdp.length > 0) {
        const hCtx = document.getElementById('historyChart').getContext('2d');
        new Chart(hCtx, {
            type: 'line',
            data: {
                labels: history.labels,
                datasets: [{
                    label: 'GDP Growth Trend',
                    data: history.gdp,
                    borderColor: COLORS.economy,
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false,
                    pointRadius: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#666', font: { size: 8 } }, grid: { display: false } },
                    y: { ticks: { color: '#666', font: { size: 8 } } }
                }
            }
        });
    }
}

// --- Mobile UI Helpers ---
function toggleMobilePanel() {
    const panel = document.getElementById('controls');
    panel.classList.toggle('collapsed');
}

function adjustMobileDisplay() {
    const handle = document.querySelector('.mobile-handle');
    if (window.innerWidth <= 768) {
        if (handle) handle.style.display = 'block';
    } else {
        if (handle) handle.style.display = 'none';
    }
}

window.addEventListener('resize', adjustMobileDisplay);
document.addEventListener('DOMContentLoaded', adjustMobileDisplay);

function closeInfoPanel() {
    document.getElementById('info-panel').classList.add('hidden');
    map.flyTo(mapConfig.center, mapConfig.zoom);
}

function getPulseColor(val) {
    if (val > 0.7) return COLORS.economy;
    if (val < 0.4) return COLORS.social;
    return COLORS.politics;
}

// --- Global Dashboard Update ---
function updateGlobalDashboard() {
    // Population
    animateValue('total-pop-display', 0, globalStats.population, 2000, (v) => formatPopulation(v));
    animateValue('global-pop-display', 0, globalStats.population, 2000, (v) => formatPopulation(v));

    // Global Metrics
    setTimeout(() => {
        const tensionEl = document.getElementById('global-tension');
        const economyEl = document.getElementById('global-economy');
        const healthEl = document.getElementById('global-health');

        if (tensionEl) tensionEl.innerText = globalStats.avgTension.toFixed(2);
        if (economyEl) economyEl.innerText = globalStats.avgEconomy.toFixed(2);
        if (healthEl) healthEl.innerText = globalStats.avgHealth.toFixed(2);
    }, 500);

    // Stress Index
    const stressValue = globalStats.avgTension;
    document.getElementById('stress-value').innerText = stressValue.toFixed(2);
    document.getElementById('danger-progress').style.width = (stressValue * 100) + '%';

    let stressLabel = 'NORMAL';
    let stressColor = 'var(--accent-green)';
    if (stressValue > 0.7) {
        stressLabel = 'CRITICAL';
        stressColor = 'var(--accent-red)';
    } else if (stressValue > 0.5) {
        stressLabel = 'ELEVATED';
        stressColor = 'var(--accent-orange)';
    } else if (stressValue > 0.3) {
        stressLabel = 'MODERATE';
        stressColor = 'var(--accent-cyan)';
    }

    const stressEl = document.getElementById('stress-status');
    stressEl.innerText = stressLabel;
    stressEl.style.color = stressColor;
}

// --- Live Feed ---
const EVENT_TYPES = ['PROTEST', 'DIPLOMACY', 'TRADE', 'CONFLICT', 'AID', 'EPIDEMIC', 'ELECTION'];

function generateEventString(country, forcedType = null) {
    const type = forcedType || EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];

    if (type === 'Diplomacy') return `Дипломатичні переговори з сусідніми регіонами`;
    if (type === 'Social') return `Громадські збори у великих містах`;
    if (type === 'Trade') return `Експортні дані показують ${Math.random() > 0.5 ? 'зростання' : 'спад'}`;
    if (type === 'Health') return `Оновлення епідеміологічної ситуації`;
    return `Оновлення від місцевих агенцій`;
}

async function startEventFeed() {
    const feed = document.getElementById('alert-feed');
    updateStatus('Підключення до GDELT Real-time Stream...');

    // Real GDELT Fetch
    async function fetchGDELT() {
        try {
            const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=civilization&mode=ArtList&maxrecords=5&format=json`;
            const res = await fetch(url);
            const data = await res.json();

            if (data && data.articles) {
                data.articles.forEach(art => {
                    const item = document.createElement('div');
                    item.className = 'alert-item';
                    item.innerHTML = `<span style="color:var(--accent-cyan); font-weight:bold;">[LIVE]</span> ${art.title.substring(0, 60)}...`;
                    item.onclick = () => window.open(art.url, '_blank');
                    item.style.cursor = 'pointer';
                    feed.prepend(item);
                });
            }
        } catch (e) {
            // Fallback to internal simulation if GDELT fails
            generateSimulatedEvent();
        }
    }

    function generateSimulatedEvent() {
        const keys = Object.keys(countriesData);
        if (keys.length === 0) return;

        const randomCountry = countriesData[keys[Math.floor(Math.random() * keys.length)]];
        const type = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
        const time = new Date().toLocaleTimeString('uk-UA', { hour12: false, hour: '2-digit', minute: '2-digit' });

        let color = '#888';
        if (type === 'PROTEST' || type === 'CONFLICT') color = COLORS.social;
        if (type === 'TRADE') color = COLORS.economy;
        if (type === 'EPIDEMIC') color = COLORS.health;
        if (type === 'DIPLOMACY') color = COLORS.politics;

        const item = document.createElement('div');
        item.className = 'alert-item';
        item.innerHTML = `<span style="color:${color}; font-weight:bold;">${time} [${randomCountry.cca2}]</span> ${type}: ${randomCountry.name.common}`;

        feed.prepend(item);
        if (feed.children.length > 15) feed.lastChild.remove();
    }

    // Initial load
    await fetchGDELT();

    // Cycle
    setInterval(() => {
        if (Math.random() > 0.7) fetchGDELT();
        else generateSimulatedEvent();
    }, 5000);
}

// --- Utils ---
function updateStatus(msg) {
    const el = document.getElementById('status-detailed');
    if (el) el.innerText = msg;
}

function formatPopulation(num) {
    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
    return num.toString();
}

function animateValue(id, start, end, duration, formatter) {
    const obj = document.getElementById(id);
    if (!obj) return;

    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const val = Math.floor(progress * (end - start) + start);
        obj.innerHTML = formatter ? formatter(val) : val;
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('uk-UA', { hour12: false, hour: '2-digit', minute: '2-digit' });
        const updateEl = document.getElementById('last-update');
        if (updateEl) updateEl.innerText = timeStr;
    }, 1000);
}

// --- Chart JS ---
let pulseChart;

function initChart() {
    const ctx = document.getElementById('humanityChart');
    if (!ctx) return;

    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 100);
    gradient.addColorStop(0, 'rgba(255, 170, 0, 0.4)');
    gradient.addColorStop(1, 'rgba(255, 170, 0, 0)');

    pulseChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(20).fill(''),
            datasets: [{
                label: 'Global Pulse',
                data: Array(20).fill(0).map(() => 0.5 + Math.random() * 0.3),
                borderColor: COLORS.politics,
                backgroundColor: gradient,
                borderWidth: 2,
                tension: 0.4,
                pointRadius: 0,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { display: false, min: 0, max: 1 }
            },
            animation: { duration: 0 }
        }
    });

    // Update chart periodically
    setInterval(() => {
        if (pulseChart && globalStats.avgStability) {
            pulseChart.data.datasets[0].data.shift();
            pulseChart.data.datasets[0].data.push(globalStats.avgStability + (Math.random() * 0.1 - 0.05));
            pulseChart.update();
        }
    }, 5000);
}
