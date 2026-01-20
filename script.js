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
