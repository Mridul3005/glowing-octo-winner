import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- STATE MANAGEMENT ---
const state = {
    // Ground station (default is San Francisco)
    observer: {
        lat: 37.7749,
        lon: -122.4194,
        alt: 30 / 1000 // In km (30 meters)
    },
    observerName: "San Francisco (Default)",
    satellites: [],
    selectedSat: null,
    selectedGroup: 'visual',
    searchQuery: '',
    onlyVisible: true,
    orbitTrailVisible: true,
    
    // UI layout modes: 'split', 'radar', 'globe'
    viewMode: 'split'
};

// Global variables for visualizers
let starsCanvas, starsCtx;
let radarCanvas, radarCtx;
let threeScene, threeCamera, threeRenderer, threeControls;
let globeGroup; // Holds Earth core, atmosphere, and grid
let observerBeacon; // 3D pulsing beacon object
let satelliteMeshPool = []; // Pool of 3D meshes for satellites
let orbitTrailLine = null; // 3D line representing selected satellite's orbit
let animationFrameId = null;

// Global variables for 3D Sky Dome
let threeSkyScene, threeSkyCamera, threeSkyRenderer, threeSkyControls;
let skySatelliteMeshPool = [];
let skyOrbitTrailLine = null;

// Throttling states to optimize DOM rendering and eliminate repaint lag
let lastClockSec = -1;
let lastVisibleCount = -1;
let lastInspectorUpdate = 0;

// TLE group descriptors
const GROUP_DESCS = {
    'visual': { title: "Brightest Visual Array", desc: "Tracking the 100 brightest satellites in the sky, highly visible to the naked eye." },
    'stations': { title: "International Space Stations", desc: "Real-time positioning of manned orbital research platforms (ISS, Tiangong)." },
    'starlink': { title: "Starlink Swarm", desc: "Live mapping of SpaceX's active low-Earth orbit telecommunication satellite swarm." },
    'weather': { title: "Weather & Earth Observation", desc: "Surveillance of NOAA, MetOp, and scientific meteorological monitoring systems." },
    'gps-ops': { title: "GPS & GNSS Navigation Array", desc: "Operational coordinates of global navigation and positioning constellations." }
};

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    initStarsBackground();
    initUI();
    initRadar();
    
    try {
        initThreeGlobe();
    } catch (e) {
        console.warn("Three.js/WebGL globe initialization failed. Graceful degradation to 2D Sky Radar active.", e);
        const globeContainer = document.getElementById('globe-container');
        if (globeContainer) {
            globeContainer.innerHTML = `
                <div class="webgl-error-fallback" style="height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 30px; color: var(--text-muted);">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 38px; color: var(--color-warning); margin-bottom: 16px; animation: flash 2s infinite alternate;"></i>
                    <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; color: #fff; margin-bottom: 8px;">3D WebGL Context Unavailable</h4>
                    <p style="font-size: 12px; line-height: 1.5; max-width: 290px;">WebGL is disabled or not supported by your browser environment. 2D Sky Radar, Ground Station Controls, and telemetry tracking remain fully functional.</p>
                </div>
            `;
        }
    }
    
    try {
        initThreeSky();
    } catch (e) {
        console.warn("Three.js/WebGL 3D sky dome initialization failed.", e);
        const skyContainer = document.getElementById('sky-container');
        if (skyContainer) {
            skyContainer.innerHTML = `
                <div class="webgl-error-fallback" style="height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 30px; color: var(--text-muted);">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 38px; color: var(--color-warning); margin-bottom: 16px;"></i>
                    <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; color: #fff; margin-bottom: 8px;">3D Sky WebGL Context Unavailable</h4>
                </div>
            `;
        }
    }
    
    // Attempt automatic location acquisition
    acquireLocation(true);
    
    // Load default TLE group
    loadSatelliteArray(state.selectedGroup);
    
    // Start main animation/propagation loop
    startTrackingLoop();
});

// --- STARFIELD BACKGROUND ---
function initStarsBackground() {
    starsCanvas = document.getElementById('stars-canvas');
    starsCtx = starsCanvas.getContext('2d');
    
    resizeStarsCanvas();
    window.addEventListener('resize', () => {
        resizeStarsCanvas();
        resizeRadarCanvas();
        if (threeCamera && threeRenderer) {
            const container = document.getElementById('globe-container');
            if (container) {
                threeCamera.aspect = container.clientWidth / container.clientHeight;
                threeCamera.updateProjectionMatrix();
                threeRenderer.setSize(container.clientWidth, container.clientHeight);
            }
        }
        if (threeSkyCamera && threeSkyRenderer) {
            const container = document.getElementById('sky-container');
            if (container) {
                threeSkyCamera.aspect = container.clientWidth / container.clientHeight;
                threeSkyCamera.updateProjectionMatrix();
                threeSkyRenderer.setSize(container.clientWidth, container.clientHeight);
            }
        }
    });

    // Generate static starry particles
    generateStars();
}

function resizeStarsCanvas() {
    starsCanvas.width = window.innerWidth;
    starsCanvas.height = window.innerHeight;
    generateStars();
}

let stars = [];
function generateStars() {
    stars = [];
    const count = Math.floor((starsCanvas.width * starsCanvas.height) / 4000);
    for (let i = 0; i < count; i++) {
        stars.push({
            x: Math.random() * starsCanvas.width,
            y: Math.random() * starsCanvas.height,
            size: Math.random() * 1.5,
            opacity: Math.random() * 0.7 + 0.3
        });
    }
    drawStars();
}

function drawStars() {
    starsCtx.clearRect(0, 0, starsCanvas.width, starsCanvas.height);
    starsCtx.fillStyle = '#ffffff';
    stars.forEach(star => {
        starsCtx.globalAlpha = star.opacity;
        starsCtx.beginPath();
        starsCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        starsCtx.fill();
    });
    starsCtx.globalAlpha = 1.0;
}

// --- UI INTERACTIONS & EVENT BINDINGS ---
function initUI() {
    // Connect Buttons for Category Switching
    const groupButtons = document.querySelectorAll('.group-btn');
    groupButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            groupButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const group = btn.getAttribute('data-group');
            state.selectedGroup = group;
            
            // Clear current selection and closed inspector
            state.selectedSat = null;
            document.getElementById('sat-inspector').classList.add('hidden');
            if (orbitTrailLine) {
                threeScene.remove(orbitTrailLine);
                orbitTrailLine = null;
            }

            // Update Headers
            const metadata = GROUP_DESCS[group] || { title: "Satellite Array", desc: "Live orbital sweep" };
            document.getElementById('active-group-title').innerText = metadata.title;
            document.getElementById('active-group-desc').innerText = metadata.desc;

            loadSatelliteArray(group);
        });
    });

    // Toggle Manual Coordinates Panel
    const btnToggleManual = document.getElementById('btn-toggle-manual');
    const manualForm = document.getElementById('manual-coords-form');
    btnToggleManual.addEventListener('click', () => {
        manualForm.classList.toggle('hidden');
        btnToggleManual.classList.toggle('active');
    });

    // Manual Coordinates Form Submission
    manualForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const lat = parseFloat(document.getElementById('input-lat').value);
        const lon = parseFloat(document.getElementById('input-lon').value);
        const alt = parseFloat(document.getElementById('input-alt').value) || 0;
        
        state.observer.lat = lat;
        state.observer.lon = lon;
        state.observer.alt = alt / 1000; // to km
        state.observerName = "Custom Location";
        
        updateGroundStationUI("online", "Manual configuration applied");
        manualForm.classList.add('hidden');
        btnToggleManual.classList.remove('active');
        
        // Re-align observer 3D beacon
        updateObserverBeacon();
        // Clear orbit trail as look angles shift
        if (state.selectedSat && state.orbitTrailVisible) {
            generateOrbitTrail(state.selectedSat);
            generateSkyOrbitTrail(state.selectedSat);
        }
    });

    // Live GPS Button
    document.getElementById('btn-gps').addEventListener('click', () => {
        acquireLocation(false);
    });

    // Search input binding
    document.getElementById('search-sats').addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
    });

    // Checklist toggles
    document.getElementById('chk-only-visible').addEventListener('change', (e) => {
        state.onlyVisible = e.target.checked;
    });

    // View Mode Toggles
    const viewGrid = document.getElementById('visualizer-grid');
    const btnSplit = document.getElementById('btn-toggle-split');
    const btnRadar = document.getElementById('btn-toggle-radar');
    const btnGlobe = document.getElementById('btn-toggle-globe');
    const btnSky = document.getElementById('btn-toggle-sky');
    
    function resetViewClasses() {
        if (viewGrid) viewGrid.classList.remove('radar-only', 'globe-only', 'sky-only');
        if (btnSplit) btnSplit.classList.remove('active');
        if (btnRadar) btnRadar.classList.remove('active');
        if (btnGlobe) btnGlobe.classList.remove('active');
        if (btnSky) btnSky.classList.remove('active');
    }

    if (btnSplit) {
        btnSplit.addEventListener('click', () => {
            resetViewClasses();
            btnSplit.classList.add('active');
            state.viewMode = 'split';
            triggerResize();
        });
    }

    if (btnRadar) {
        btnRadar.addEventListener('click', () => {
            resetViewClasses();
            if (viewGrid) viewGrid.classList.add('radar-only');
            btnRadar.classList.add('active');
            state.viewMode = 'radar';
            triggerResize();
        });
    }

    if (btnGlobe) {
        btnGlobe.addEventListener('click', () => {
            resetViewClasses();
            if (viewGrid) viewGrid.classList.add('globe-only');
            btnGlobe.classList.add('active');
            state.viewMode = 'globe';
            triggerResize();
        });
    }

    if (btnSky) {
        btnSky.addEventListener('click', () => {
            resetViewClasses();
            if (viewGrid) viewGrid.classList.add('sky-only');
            btnSky.classList.add('active');
            state.viewMode = 'sky';
            triggerResize();
        });
    }

    // Inspector close button
    const btnCloseInspector = document.getElementById('btn-close-inspector');
    if (btnCloseInspector) {
        btnCloseInspector.addEventListener('click', () => {
            state.selectedSat = null;
            const inspectorPanel = document.getElementById('sat-inspector');
            if (inspectorPanel) inspectorPanel.classList.add('hidden');
            if (orbitTrailLine && threeScene) {
                threeScene.remove(orbitTrailLine);
                orbitTrailLine = null;
            }
            if (skyOrbitTrailLine && threeSkyScene) {
                threeSkyScene.remove(skyOrbitTrailLine);
                skyOrbitTrailLine = null;
            }
        });
    }

    // Inspector toggle orbit trail button
    const btnToggleOrbit = document.getElementById('btn-toggle-orbit');
    if (btnToggleOrbit) {
        btnToggleOrbit.addEventListener('click', () => {
            state.orbitTrailVisible = !state.orbitTrailVisible;
            if (state.orbitTrailVisible) {
                btnToggleOrbit.classList.add('btn-glow');
                if (state.selectedSat) {
                    generateOrbitTrail(state.selectedSat);
                    generateSkyOrbitTrail(state.selectedSat);
                }
            } else {
                btnToggleOrbit.classList.remove('btn-glow');
                if (orbitTrailLine && threeScene) {
                    threeScene.remove(orbitTrailLine);
                    orbitTrailLine = null;
                }
                if (skyOrbitTrailLine && threeSkyScene) {
                    threeSkyScene.remove(skyOrbitTrailLine);
                    skyOrbitTrailLine = null;
                }
            }
        });
    }

}

function triggerResize() {
    setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
    }, 50);
}

function acquireLocation(silent = false) {
    const statusText = document.getElementById('station-status');
    const indicator = document.querySelector('.status-indicator');
    
    if (!navigator.geolocation) {
        updateGroundStationUI("offline", "Geolocation not supported by browser");
        return;
    }
    
    indicator.className = "status-indicator acquiring";
    if (!silent) statusText.innerText = "Requesting GPS authorization...";
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            state.observer.lat = position.coords.latitude;
            state.observer.lon = position.coords.longitude;
            state.observer.alt = (position.coords.altitude || 0) / 1000; // meters to km
            state.observerName = "GPS Ground Station";
            
            updateGroundStationUI("online", "Connected via Browser GPS");
            
            // Populate form values just in case
            document.getElementById('input-lat').value = state.observer.lat.toFixed(4);
            document.getElementById('input-lon').value = state.observer.lon.toFixed(4);
            document.getElementById('input-alt').value = Math.round(state.observer.alt * 1000);
            
            updateObserverBeacon();
            if (state.selectedSat && state.orbitTrailVisible) {
                generateOrbitTrail(state.selectedSat);
                generateSkyOrbitTrail(state.selectedSat);
            }
        },
        (error) => {
            console.warn("Geolocation acquisition failed:", error.message);
            updateGroundStationUI("online", silent ? "Using San Francisco (Default)" : `GPS Denied: ${error.message}`);
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
}

function updateGroundStationUI(status, text) {
    const indicator = document.querySelector('.status-indicator');
    const statusText = document.getElementById('station-status');
    
    indicator.className = `status-indicator ${status}`;
    statusText.innerText = text;
    
    // Format Display Values
    const lat = state.observer.lat;
    const lon = state.observer.lon;
    document.getElementById('disp-lat').innerText = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
    document.getElementById('disp-lon').innerText = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
    document.getElementById('disp-alt').innerText = `${Math.round(state.observer.alt * 1000)} meters`;
}

// --- FETCH & PARSE SATELLITE TLE DATA ---
async function loadSatelliteArray(group) {
    const countEl = document.getElementById('stat-sat-count');
    countEl.innerText = "Loading...";
    
    try {
        const response = await fetch(`/api/satellites?group=${group}`);
        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
        
        const rawTleText = await response.text();
        parseTLEData(rawTleText);
    } catch (err) {
        console.error("Failed to load satellite data:", err);
        countEl.innerText = "ERROR";
        document.getElementById('active-group-desc').innerText = `Failed to download: ${err.message}. Backend might be fetching...`;
    }
}

function parseTLEData(rawText) {
    const lines = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const parsedSats = [];
    
    // Celestrak format: chunks of 3 lines
    // Line 0: Satellite Name
    // Line 1: TLE Line 1
    // Line 2: TLE Line 2
    for (let i = 0; i < lines.length - 2; i++) {
        const line0 = lines[i];
        const line1 = lines[i+1];
        const line2 = lines[i+2];
        
        // Basic validation: Line 1 should start with '1 ' and Line 2 with '2 '
        if (line1.startsWith('1 ') && line2.startsWith('2 ')) {
            try {
                // Initialize satellite record using satellite.js
                const satrec = satellite.twoline2satrec(line1, line2);
                
                // Calculate estimated orbital period in minutes
                // Mean motion (revolutions per day) is in lines[i+2], indices 52-63
                const meanMotionRevPerDay = parseFloat(line2.substring(52, 63));
                const periodMinutes = meanMotionRevPerDay ? (24 * 60) / meanMotionRevPerDay : 92.5;

                parsedSats.push({
                    name: line0.replace(/^0\s+/, '').trim(), // Strip Celestrak's leading '0 '
                    tleLine1: line1,
                    tleLine2: line2,
                    satrec: satrec,
                    noradId: line1.substring(2, 7).trim(),
                    period: periodMinutes,
                    visible: false,
                    lookAngles: { azimuth: 0, elevation: -1, rangeSat: 9999 },
                    positionGd: { latitude: 0, longitude: 0, height: 300 },
                    positionEcf: { x: 0, y: 0, z: 0 }
                });
            } catch (err) {
                // Skip malformed records
            }
            i += 2; // Jump forward 3 lines
        }
    }
    
    state.satellites = parsedSats;
    document.getElementById('stat-sat-count').innerText = parsedSats.length;
}

// --- 2D SKY RADAR DOME ---
function initRadar() {
    radarCanvas = document.getElementById('radar-canvas');
    radarCtx = radarCanvas.getContext('2d');
    resizeRadarCanvas();

    // Click handler for selecting satellite on radar
    radarCanvas.addEventListener('click', (e) => {
        const rect = radarCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        const size = Math.min(rect.width, rect.height);
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const radarRadius = (size / 2) - 25; // padding
        
        let closestSat = null;
        let minDistance = 15; // Click radius threshold in pixels
        
        // Find visible satellites closest to click
        state.satellites.forEach(sat => {
            if (!sat.visible) return;
            
            // Map look angles to screen coordinates
            const elevationRad = sat.lookAngles.elevation;
            const azimuthRad = sat.lookAngles.azimuth;
            
            const r = radarRadius * (1 - elevationRad / (Math.PI / 2));
            const theta = azimuthRad - Math.PI / 2;
            const sx = centerX + r * Math.cos(theta);
            const sy = centerY + r * Math.sin(theta);
            
            const dist = Math.sqrt((clickX - sx) ** 2 + (clickY - sy) ** 2);
            if (dist < minDistance) {
                minDistance = dist;
                closestSat = sat;
            }
        });
        
        if (closestSat) {
            selectSatellite(closestSat);
        }
    });
}

function resizeRadarCanvas() {
    const parent = radarCanvas.parentElement;
    const size = Math.min(parent.clientWidth, parent.clientHeight - 20);
    radarCanvas.width = size;
    radarCanvas.height = size;
}

// Render the sweeping radar overlay
let radarSweepAngle = 0;
function drawRadarBackground(width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const radarRadius = (Math.min(width, height) / 2) - 25;
    
    // Clear canvas
    radarCtx.clearRect(0, 0, width, height);
    
    // Base Glow Outer Circle
    radarCtx.strokeStyle = 'rgba(0, 255, 102, 0.15)';
    radarCtx.lineWidth = 1;
    
    // Concentric grids: horizon, 30° elevation, 60° elevation
    const gridCircles = [1.0, 2/3, 1/3];
    const gridLabels = ["Horizon (0°)", "30° Elev", "60° Elev"];
    
    gridCircles.forEach((pct, idx) => {
        radarCtx.beginPath();
        radarCtx.arc(centerX, centerY, radarRadius * pct, 0, Math.PI * 2);
        radarCtx.fillStyle = 'rgba(10, 25, 15, 0.05)';
        radarCtx.fill();
        radarCtx.stroke();
        
        // Labels
        radarCtx.fillStyle = 'rgba(0, 255, 102, 0.35)';
        radarCtx.font = '9px Orbitron, monospace';
        radarCtx.fillText(gridLabels[idx], centerX + 5, centerY - (radarRadius * pct) + 12);
    });
    
    // Cardinal axes lines
    radarCtx.strokeStyle = 'rgba(0, 255, 102, 0.15)';
    radarCtx.beginPath();
    radarCtx.moveTo(centerX, centerY - radarRadius);
    radarCtx.lineTo(centerX, centerY + radarRadius);
    radarCtx.moveTo(centerX - radarRadius, centerY);
    radarCtx.lineTo(centerX + radarRadius, centerY);
    radarCtx.stroke();
    
    // Lighter diagonal ticks
    radarCtx.strokeStyle = 'rgba(0, 255, 102, 0.05)';
    radarCtx.beginPath();
    const angles = [Math.PI/4, 3*Math.PI/4, 5*Math.PI/4, 7*Math.PI/4];
    angles.forEach(a => {
        radarCtx.moveTo(centerX, centerY);
        radarCtx.lineTo(centerX + radarRadius * Math.cos(a), centerY + radarRadius * Math.sin(a));
    });
    radarCtx.stroke();

    // Radar Sweeper Beam Effect
    radarSweepAngle = (radarSweepAngle + 0.006) % (Math.PI * 2);
    const sweepGradient = radarCtx.createRadialGradient(centerX, centerY, 5, centerX, centerY, radarRadius);
    sweepGradient.addColorStop(0, 'rgba(0, 255, 102, 0.15)');
    sweepGradient.addColorStop(0.8, 'rgba(0, 255, 102, 0.02)');
    sweepGradient.addColorStop(1, 'rgba(0, 255, 102, 0)');
    
    radarCtx.fillStyle = sweepGradient;
    radarCtx.beginPath();
    radarCtx.moveTo(centerX, centerY);
    radarCtx.arc(centerX, centerY, radarRadius, radarSweepAngle - 0.25, radarSweepAngle);
    radarCtx.closePath();
    radarCtx.fill();
    
    // Highlighted sweep edge
    radarCtx.strokeStyle = 'rgba(0, 255, 102, 0.4)';
    radarCtx.lineWidth = 1.5;
    radarCtx.beginPath();
    radarCtx.moveTo(centerX, centerY);
    radarCtx.lineTo(centerX + radarRadius * Math.cos(radarSweepAngle), centerY + radarRadius * Math.sin(radarSweepAngle));
    radarCtx.stroke();
}

function drawRadarSatellites(width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const radarRadius = (Math.min(width, height) / 2) - 25;
    
    let visibleCount = 0;
    
    state.satellites.forEach(sat => {
        // Apply filters
        const matchesSearch = !state.searchQuery || sat.name.toLowerCase().includes(state.searchQuery) || sat.noradId.includes(state.searchQuery);
        
        if (!sat.visible) return; // Must be above horizon to appear on sky radar
        if (!matchesSearch) return;
        
        visibleCount++;
        
        // Map Look Angles (Azimuth/Elevation) to Polar Canvas space
        const elevationRad = sat.lookAngles.elevation;
        const azimuthRad = sat.lookAngles.azimuth;
        
        // distance from center is proportional to (90 - elevation)
        // Elev = 90 (Zenith) -> r = 0 (Center)
        // Elev = 0 (Horizon) -> r = radarRadius (Outer rim)
        const r = radarRadius * (1 - elevationRad / (Math.PI / 2));
        
        // polar angle: Azimuth measures clockwise from North (which is straight up, i.e., -PI/2)
        const theta = azimuthRad - Math.PI / 2;
        const sx = centerX + r * Math.cos(theta);
        const sy = centerY + r * Math.sin(theta);
        
        // Check selection status
        const isSelected = state.selectedSat && state.selectedSat.noradId === sat.noradId;
        const isStation = sat.name.includes("ISS") || sat.name.includes("TIANGONG") || sat.name.includes("CSS");
        
        // Base Dot Size
        const dotRadius = isSelected ? 6 : (isStation ? 4.5 : 3.5);
        
        // Draw glow backings for visible satellites
        radarCtx.beginPath();
        radarCtx.arc(sx, sy, dotRadius + 3, 0, Math.PI * 2);
        if (isSelected) {
            radarCtx.fillStyle = 'rgba(0, 240, 255, 0.25)';
        } else if (isStation) {
            radarCtx.fillStyle = 'rgba(185, 43, 255, 0.25)';
        } else {
            radarCtx.fillStyle = 'rgba(0, 255, 102, 0.15)';
        }
        radarCtx.fill();
        
        // Solid core
        radarCtx.beginPath();
        radarCtx.arc(sx, sy, dotRadius, 0, Math.PI * 2);
        if (isSelected) {
            radarCtx.fillStyle = varColor('cyan');
        } else if (isStation) {
            radarCtx.fillStyle = varColor('accent');
        } else {
            radarCtx.fillStyle = varColor('green');
        }
        radarCtx.fill();
        
        // Selected indicator ring
        if (isSelected) {
            radarCtx.strokeStyle = '#ffffff';
            radarCtx.lineWidth = 1;
            radarCtx.beginPath();
            radarCtx.arc(sx, sy, dotRadius + 5, 0, Math.PI * 2);
            radarCtx.stroke();
        }

        // Draw names for selected, stations, or when searched
        const shouldDrawLabel = isSelected || isStation || (state.searchQuery && state.searchQuery.length > 0) || state.satellites.length < 25;
        if (shouldDrawLabel) {
            radarCtx.fillStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.75)';
            radarCtx.font = isSelected ? 'bold 10px Outfit, sans-serif' : '9px Outfit, sans-serif';
            radarCtx.fillText(sat.name, sx + dotRadius + 5, sy + 3);
        }
    });

    // Only update DOM when the count changes to eliminate unnecessary repaints
    if (visibleCount !== lastVisibleCount) {
        lastVisibleCount = visibleCount;
        document.getElementById('stat-visible-count').innerText = visibleCount;
    }
}

// Helper to resolve CSS variables in canvas contexts
function varColor(name) {
    switch(name) {
        case 'cyan': return '#00f0ff';
        case 'blue': return '#0072ff';
        case 'green': return '#00ff66';
        case 'accent': return '#b92bff';
        case 'warning': return '#ff3366';
        default: return '#ffffff';
    }
}

// --- THREE.JS 3D HOLOGRAPHIC GLOBE ---
function initThreeGlobe() {
    const container = document.getElementById('globe-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene setup
    threeScene = new THREE.Scene();
    threeScene.fog = new THREE.FogExp2(0x05060b, 0.001);

    // 2. Camera setup
    threeCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    // Position camera looking down from an angle
    threeCamera.position.set(0, 150, 250);

    // 3. Renderer setup
    threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeRenderer.setSize(width, height);
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(threeRenderer.domElement);

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0x0b132b, 0.8);
    threeScene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x00f0ff, 1.2);
    dirLight.position.set(100, 150, 50);
    threeScene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0xb92bff, 0.4);
    dirLight2.position.set(-100, -100, -100);
    threeScene.add(dirLight2);

    // 5. Build Globe Group
    globeGroup = new THREE.Group();
    threeScene.add(globeGroup);

    // Core Earth Sphere (translucent glowing core)
    const earthRadius = 100;
    const coreGeo = new THREE.SphereGeometry(earthRadius, 40, 40);
    const coreMat = new THREE.MeshPhongMaterial({
        color: 0x070c1b,
        emissive: 0x050f2b,
        specular: 0x00f0ff,
        shininess: 20,
        transparent: true,
        opacity: 0.85,
        bumpScale: 1
    });
    const earthCore = new THREE.Mesh(coreGeo, coreMat);
    globeGroup.add(earthCore);

    // Lat/Lon Wireframe Grid
    const gridGeo = new THREE.SphereGeometry(earthRadius + 0.2, 36, 18);
    const gridMat = new THREE.MeshBasicMaterial({
        color: 0x0072ff,
        wireframe: true,
        transparent: true,
        opacity: 0.15
    });
    const earthGrid = new THREE.Mesh(gridGeo, gridMat);
    globeGroup.add(earthGrid);

    // Equator Line (thicker glowing grid ring)
    const equatorGeo = new THREE.RingGeometry(earthRadius + 0.3, earthRadius + 0.9, 64);
    const equatorMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35
    });
    const equator = new THREE.Mesh(equatorGeo, equatorMat);
    equator.rotation.x = Math.PI / 2; // Lie flat along XZ plane
    globeGroup.add(equator);

    // Prime Meridian glowing ring
    const primeMerGeo = new THREE.RingGeometry(earthRadius + 0.3, earthRadius + 0.9, 64);
    const primeMerMat = new THREE.MeshBasicMaterial({
        color: 0x0072ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.2
    });
    const primeMer = new THREE.Mesh(primeMerGeo, primeMerMat);
    primeMer.rotation.y = 0; // Rotates around Y axis
    globeGroup.add(primeMer);

    // Atmosphere Glow Envelope
    const atmosGeo = new THREE.SphereGeometry(earthRadius + 8, 32, 32);
    const atmosMat = new THREE.MeshBasicMaterial({
        color: 0x0072ff,
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide
    });
    const atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
    globeGroup.add(atmosphere);

    // 6. Observer Ground Station Beacon
    initObserverBeacon();

    // 7. Controls setup
    threeControls = new OrbitControls(threeCamera, threeRenderer.domElement);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.05;
    threeControls.minDistance = 120;
    threeControls.maxDistance = 750;
    threeControls.autoRotate = false;
    threeControls.autoRotateSpeed = 0.5;

    // Raycast selector for Three.js clicks
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    threeRenderer.domElement.addEventListener('click', (e) => {
        const rect = threeRenderer.domElement.getBoundingClientRect();
        // Calculate mouse position in normalized device coordinates (-1 to +1)
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, threeCamera);
        
        // Intersect only with satellite meshes that are currently visible
        const activeMeshes = satelliteMeshPool
            .filter(item => item.mesh.visible)
            .map(item => item.mesh);

        const intersects = raycaster.intersectObjects(activeMeshes);
        
        if (intersects.length > 0) {
            const hitMesh = intersects[0].object;
            const hitRecord = satelliteMeshPool.find(item => item.mesh === hitMesh);
            if (hitRecord && hitRecord.satelliteData) {
                selectSatellite(hitRecord.satelliteData);
            }
        }
    });
}

function initObserverBeacon() {
    if (observerBeacon) {
        globeGroup.remove(observerBeacon);
    }
    
    observerBeacon = new THREE.Group();
    globeGroup.add(observerBeacon);
    
    // Core pin
    const pinGeo = new THREE.SphereGeometry(1.8, 16, 16);
    const pinMat = new THREE.MeshBasicMaterial({
        color: 0xff3366,
        transparent: true,
        opacity: 0.95
    });
    const pin = new THREE.Mesh(pinGeo, pinMat);
    observerBeacon.add(pin);

    // Glowing coordinate rings
    const beaconRingGeo = new THREE.RingGeometry(2.5, 4.5, 32);
    const beaconRingMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6
    });
    const ring = new THREE.Mesh(beaconRingGeo, beaconRingMat);
    
    // We want the ring to lie flat on the Earth's surface at this point
    // We will align the group later, so we just rotate the ring flat in the group
    ring.rotation.x = Math.PI / 2;
    observerBeacon.add(ring);

    updateObserverBeacon();
}

function updateObserverBeacon() {
    if (!observerBeacon) return;
    
    // Convert Geodetic (Lat/Lon) to Cartesian Coordinates
    const latRad = satellite.degreesToRadians(state.observer.lat);
    const lonRad = satellite.degreesToRadians(state.observer.lon);
    const earthRadius = 100;
    
    // Coordinates mapping:
    // +y points North
    // +z points to 0° Lon (Prime Meridian)
    // +x points to 90° E
    const y = earthRadius * Math.sin(latRad);
    const x = earthRadius * Math.cos(latRad) * Math.sin(lonRad);
    const z = earthRadius * Math.cos(latRad) * Math.cos(lonRad);
    
    observerBeacon.position.set(x, y, z);
    
    // Make the beacon group look outward from Earth center (normal vector)
    // In Three.js, lookAt orientates Z axis of mesh to the target.
    // The beacon's rings lie flat in the XZ plane, i.e., normal is Y.
    // So we can align it by setting up a quaternion rotation aligning $+y$ with the position vector!
    const positionVec = new THREE.Vector3(x, y, z).normalize();
    const upVec = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(upVec, positionVec);
    observerBeacon.setRotationFromQuaternion(quaternion);
}

// Dynamic mesh pool builder to render satellites in 3D
function update3DSatellites() {
    // Hide all existing meshes initially, we will enable and position active ones
    satelliteMeshPool.forEach(item => {
        item.mesh.visible = false;
        item.satelliteData = null;
    });
    
    let meshIndex = 0;
    
    state.satellites.forEach(sat => {
        // Apply filters
        const matchesSearch = !state.searchQuery || sat.name.toLowerCase().includes(state.searchQuery) || sat.noradId.includes(state.searchQuery);
        
        // Filter options
        if (state.onlyVisible && !sat.visible) return;
        if (!matchesSearch) return;

        // Skip decayed / unpropagated records
        if (!sat.positionEcf || isNaN(sat.positionEcf.x)) return;

        // Determine Selection
        const isSelected = state.selectedSat && state.selectedSat.noradId === sat.noradId;
        const isStation = sat.name.includes("ISS") || sat.name.includes("TIANGONG") || sat.name.includes("CSS");

        // Scale coordinates: Earth Radius = 6371km, represented by 100 units in Three.js
        const scale = 100 / 6371;
        const x = sat.positionEcf.x * scale;
        const y = sat.positionEcf.z * scale; // Map ECEF Z (North) to Three.js Y (Up)
        const z = sat.positionEcf.x * scale; // Map ECEF X (Prime Meridian) to Three.js Z (Forward)
        const x_ecf = sat.positionEcf.x * scale;
        const y_ecf = sat.positionEcf.y * scale;
        const z_ecf = sat.positionEcf.z * scale;

        // Correct axis alignment:
        // ECEF Z points North -> Three Y-axis
        // ECEF X points Prime Meridian -> Three Z-axis
        // ECEF Y points 90E -> Three X-axis
        const threeX = y_ecf;
        const threeY = z_ecf;
        const threeZ = x_ecf;

        // Acquire or create a mesh from the pool
        let satMeshObject;
        if (meshIndex < satelliteMeshPool.length) {
            satMeshObject = satelliteMeshPool[meshIndex];
        } else {
            // Create a new mesh
            // Use glowing diamond/octahedron shapes for scientific look
            const geom = new THREE.OctahedronGeometry(1.2, 0);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
            const mesh = new THREE.Mesh(geom, mat);
            threeScene.add(mesh);
            
            satMeshObject = { mesh: mesh, satelliteData: null };
            satelliteMeshPool.push(satMeshObject);
        }
        
        satMeshObject.mesh.position.set(threeX, threeY, threeZ);
        satMeshObject.mesh.visible = true;
        satMeshObject.satelliteData = sat; // Keep reference to back-populate clicks
        
        // Color-coding based on type and selection
        if (isSelected) {
            satMeshObject.mesh.material.color.setHex(0x00f0ff);
            satMeshObject.mesh.scale.set(1.6, 1.6, 1.6);
        } else if (isStation) {
            satMeshObject.mesh.material.color.setHex(0xb92bff);
            satMeshObject.mesh.scale.set(1.3, 1.3, 1.3);
        } else {
            satMeshObject.mesh.material.color.setHex(sat.visible ? 0x00ff66 : 0x0072ff);
            satMeshObject.mesh.scale.set(1.0, 1.0, 1.0);
        }

        meshIndex++;
    });
}

// Generate a 3D orbit trail line wrapping around the rotating globe
function generateOrbitTrail(sat) {
    if (typeof threeScene === 'undefined' || !threeScene) return;

    if (orbitTrailLine) {
        threeScene.remove(orbitTrailLine);
        orbitTrailLine = null;
    }
    
    if (!state.orbitTrailVisible || !sat) return;

    const points = [];
    const scale = 100 / 6371;
    const now = new Date();
    
    // Low earth orbit periods are ~90 mins. We compute look angles every minute
    // to map a smooth trace of 1 full orbital period.
    const steps = 90;
    const startOffsetMinutes = -45;
    
    const originalGmst = satellite.gstime(now);

    for (let i = 0; i <= steps; i++) {
        const offsetTime = new Date(now.getTime() + (startOffsetMinutes + i) * 60 * 1000);
        const positionEci = satellite.propagate(sat.satrec, offsetTime);
        
        if (positionEci && positionEci.position) {
            // Earth rotates relative to inertial coordinates, so we must calculate GMST
            // at each step's time to resolve the Earth-Centered, Earth-Fixed (ECEF) coordinates
            // so that the track stays perfectly aligned with the Earth sphere!
            const gmstStep = satellite.gstime(offsetTime);
            const ecfPos = satellite.eciToEcf(positionEci.position, gmstStep);
            
            if (ecfPos && !isNaN(ecfPos.x)) {
                // Map to Three axes:
                // ECEF Z -> Y (up)
                // ECEF Y -> X (right)
                // ECEF X -> Z (forward)
                points.push(new THREE.Vector3(
                    ecfPos.y * scale,
                    ecfPos.z * scale,
                    ecfPos.x * scale
                ));
            }
        }
    }
    
    if (points.length > 0) {
        // Close the loop to look completely round if orbit fits nicely
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.6,
            linewidth: 1.5
        });
        orbitTrailLine = new THREE.Line(geometry, material);
        threeScene.add(orbitTrailLine);
    }
}

// --- 3D VIRTUAL SKY DOME VISUALIZER ---
function initThreeSky() {
    const container = document.getElementById('sky-container');
    if (!container) return;
    
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene setup
    threeSkyScene = new THREE.Scene();
    threeSkyScene.fog = new THREE.FogExp2(0x05060b, 0.001);

    // 2. Camera setup: Stand at the center Y = 2 (observer eye level)
    threeSkyCamera = new THREE.PerspectiveCamera(65, width / height, 0.1, 1000);
    threeSkyCamera.position.set(0, 2, 0.1);

    // 3. Renderer setup
    threeSkyRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeSkyRenderer.setSize(width, height);
    threeSkyRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(threeSkyRenderer.domElement);

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0x0b132b, 0.9);
    threeSkyScene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x00f0ff, 1.2);
    dirLight1.position.set(50, 150, 50);
    threeSkyScene.add(dirLight1);

    // 5. Build Sky Dome elements
    // Polar Grid radar ground plane
    const polarGrid = new THREE.PolarGridHelper(100, 16, 8, 64, 0x0072ff, 0x071e3d);
    polarGrid.position.y = 0.05;
    threeSkyScene.add(polarGrid);

    // Domed wireframe representation of the sky
    const domeGeo = new THREE.SphereGeometry(100, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
        color: 0x00ff66,
        wireframe: true,
        transparent: true,
        opacity: 0.06
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    threeSkyScene.add(dome);

    // Concentric horizontal guides (Horizon, 30, 60, Zenith)
    const guides = [30, 60];
    guides.forEach(angle => {
        const rad = 100 * Math.cos(angle * Math.PI / 180);
        const y = 100 * Math.sin(angle * Math.PI / 180);
        const ringGeo = new THREE.RingGeometry(rad - 0.2, rad + 0.2, 64);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00ff66,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.12
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        threeSkyScene.add(ring);
    });

    // 6. Cardinal Compass text sprites
    const nSprite = createTextSprite("N", "#ffffff");
    nSprite.position.set(0, 3, -98);
    threeSkyScene.add(nSprite);

    const eSprite = createTextSprite("E", "#ffffff");
    eSprite.position.set(98, 3, 0);
    threeSkyScene.add(eSprite);

    const sSprite = createTextSprite("S", "#ffffff");
    sSprite.position.set(0, 3, 98);
    threeSkyScene.add(sSprite);

    const wSprite = createTextSprite("W", "#ffffff");
    wSprite.position.set(-98, 3, 0);
    threeSkyScene.add(wSprite);

    // 7. Observer Station center mesh
    //const stationGroup = new THREE.Group();
    //threeSkyScene.add(stationGroup);

    // Glowing base ring
    //const baseRingGeo = new THREE.RingGeometry(0, 4, 32);
    //const baseRingMat = new THREE.MeshBasicMaterial({
    //    color: 0xff3366,
    //    side: THREE.DoubleSide,
    //    transparent: true,
    //    opacity: 0.4
    //});
    //const baseRing = new THREE.Mesh(baseRingGeo, baseRingMat);
    //baseRing.rotation.x = Math.PI / 2;
    //stationGroup.add(baseRing);

    // Central pulsing radar tower/beacon
    //const beaconGeo = new THREE.ConeGeometry(1.5, 6, 16);
    //const beaconMat = new THREE.MeshPhongMaterial({
    //    color: 0xff3366,
    //    emissive: 0x4a001a,
    //    transparent: true,
    //    opacity: 0.8
    //});
    //const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    //beacon.position.y = 3;
    //stationGroup.add(beacon);

    // 8. OrbitControls setup: Lock camera distance to look around from center
    threeSkyControls = new OrbitControls(threeSkyCamera, threeSkyRenderer.domElement);
    threeSkyControls.enableDamping = true;
    threeSkyControls.dampingFactor = 0.05;
    threeSkyControls.enablePan = false; // Prevent panning away from center
    threeSkyControls.minDistance = 0.1; // Lock zoom at observer center
    threeSkyControls.maxDistance = 0.1;
    threeSkyControls.target.set(0, 2, 0); // Focus target at observer eye-level

    // 9. Raycasting click handler for Sky Domed Satellites
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    threeSkyRenderer.domElement.addEventListener('click', (e) => {
        const rect = threeSkyRenderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, threeSkyCamera);
        
        const activeSkyMeshes = skySatelliteMeshPool
            .filter(item => item.mesh.visible)
            .map(item => item.mesh);

        const intersects = raycaster.intersectObjects(activeSkyMeshes);
        
        if (intersects.length > 0) {
            const hitMesh = intersects[0].object;
            const hitRecord = skySatelliteMeshPool.find(item => item.mesh === hitMesh);
            if (hitRecord && hitRecord.satelliteData) {
                selectSatellite(hitRecord.satelliteData);
            }
        }
    });

    // 10. Telescopic FOV Zoom (Wheel/Scroll)
    // Adjusts camera FOV to act exactly like an optical zoom lens,
    // allowing zoom-in magnification while keeping observer position perfectly fixed!
    threeSkyRenderer.domElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSpeed = 0.04;
        let newFov = threeSkyCamera.fov + e.deltaY * zoomSpeed;
        
        // Clamp FOV between 15° (telephoto zoom) and 85° (wide panorama)
        newFov = Math.max(15, Math.min(85, newFov));
        
        threeSkyCamera.fov = newFov;
        threeSkyCamera.updateProjectionMatrix();
    }, { passive: false });
}

function createTextSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    ctx.font = 'bold 72px Outfit, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.shadowColor = 'rgba(0, 240, 255, 0.6)';
    ctx.shadowBlur = 8;
    ctx.fillText(text, 64, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(12, 12, 1);
    return sprite;
}

function updateSkySatellites() {
    skySatelliteMeshPool.forEach(item => {
        item.mesh.visible = false;
        item.satelliteData = null;
    });

    let meshIndex = 0;
    const domeRadius = 100;

    state.satellites.forEach(sat => {
        const matchesSearch = !state.searchQuery || sat.name.toLowerCase().includes(state.searchQuery) || sat.noradId.includes(state.searchQuery);
        
        if (!sat.visible || !matchesSearch) return;
        if (!sat.lookAngles || sat.lookAngles.elevation <= 0) return;

        const isSelected = state.selectedSat && state.selectedSat.noradId === sat.noradId;
        const isStation = sat.name.includes("ISS") || sat.name.includes("TIANGONG") || sat.name.includes("CSS");

        const azimRad = sat.lookAngles.azimuth;
        const elevRad = sat.lookAngles.elevation;

        const x = domeRadius * Math.cos(elevRad) * Math.sin(azimRad);
        const y = domeRadius * Math.sin(elevRad);
        const z = -domeRadius * Math.cos(elevRad) * Math.cos(azimRad);

        let satMeshObject;
        if (meshIndex < skySatelliteMeshPool.length) {
            satMeshObject = skySatelliteMeshPool[meshIndex];
        } else {
            const geom = new THREE.OctahedronGeometry(1.5, 0);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
            const mesh = new THREE.Mesh(geom, mat);
            threeSkyScene.add(mesh);
            
            satMeshObject = { mesh: mesh, satelliteData: null };
            skySatelliteMeshPool.push(satMeshObject);
        }

        satMeshObject.mesh.position.set(x, y, z);
        satMeshObject.mesh.visible = true;
        satMeshObject.satelliteData = sat;

        if (isSelected) {
            satMeshObject.mesh.material.color.setHex(0x00f0ff);
            satMeshObject.mesh.scale.set(1.6, 1.6, 1.6);
        } else if (isStation) {
            satMeshObject.mesh.material.color.setHex(0xb92bff);
            satMeshObject.mesh.scale.set(1.3, 1.3, 1.3);
        } else {
            satMeshObject.mesh.material.color.setHex(0x00ff66);
            satMeshObject.mesh.scale.set(1.0, 1.0, 1.0);
        }

        meshIndex++;
    });
}

function generateSkyOrbitTrail(sat) {
    if (typeof threeSkyScene === 'undefined' || !threeSkyScene) return;

    if (skyOrbitTrailLine) {
        threeSkyScene.remove(skyOrbitTrailLine);
        skyOrbitTrailLine = null;
    }

    if (!state.orbitTrailVisible || !sat) return;

    const points = [];
    const domeRadius = 100;
    const now = new Date();

    const steps = 90;
    const startOffsetMinutes = -45;
    
    const obsGdRad = {
        latitude: satellite.degreesToRadians(state.observer.lat),
        longitude: satellite.degreesToRadians(state.observer.lon),
        height: state.observer.alt
    };

    for (let i = 0; i <= steps; i++) {
        const offsetTime = new Date(now.getTime() + (startOffsetMinutes + i) * 60 * 1000);
        const positionEci = satellite.propagate(sat.satrec, offsetTime);

        if (positionEci && positionEci.position) {
            const gmstStep = satellite.gstime(offsetTime);
            const ecfPos = satellite.eciToEcf(positionEci.position, gmstStep);

            if (ecfPos && !isNaN(ecfPos.x)) {
                const look = satellite.ecfToLookAngles(obsGdRad, ecfPos);
                
                if (look.elevation >= 0) {
                    const azim = look.azimuth;
                    const elev = look.elevation;

                    const x = domeRadius * Math.cos(elev) * Math.sin(azim);
                    const y = domeRadius * Math.sin(elev);
                    const z = -domeRadius * Math.cos(elev) * Math.cos(azim);

                    points.push(new THREE.Vector3(x, y, z));
                }
            }
        }
    }

    if (points.length > 0) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.7,
            linewidth: 2
        });
        skyOrbitTrailLine = new THREE.Line(geometry, material);
        threeSkyScene.add(skyOrbitTrailLine);
    }
}

// --- CORE PROPAGATION ENGINE & LOOP ---
function startTrackingLoop() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    function tick() {
        const now = new Date();
        
        // 1. Live clocks update
        updateClocks(now);
        
        // 2. Propagate orbits
        propagateOrbits(now);
        
        // 3. Draw visualizers
        const rWidth = radarCanvas.width;
        const rHeight = radarCanvas.height;
        
        // Draw 2D canvas radar dome
        if (state.viewMode === 'split' || state.viewMode === 'radar') {
            drawRadarBackground(rWidth, rHeight);
            drawRadarSatellites(rWidth, rHeight);
        }
        
        // Update 3D WebGL meshes and orbit trail
        if ((state.viewMode === 'split' || state.viewMode === 'globe') && typeof threeRenderer !== 'undefined' && threeRenderer) {
            update3DSatellites();
            
            // Animate pulses on observer beacon
            if (observerBeacon) {
                // Slowly rotate beacon rings
                observerBeacon.children[1].rotation.z += 0.01;
            }
            
            threeControls.update();
            threeRenderer.render(threeScene, threeCamera);
        }
        
        // Update 3D Sky Dome meshes and render
        if (state.viewMode === 'sky' && typeof threeSkyRenderer !== 'undefined' && threeSkyRenderer) {
            updateSkySatellites();
            
            threeSkyControls.update();
            threeSkyRenderer.render(threeSkyScene, threeSkyCamera);
        }
        
        // Live inspector panel values
        updateInspectorPanel();
        
        animationFrameId = requestAnimationFrame(tick);
    }
    
    animationFrameId = requestAnimationFrame(tick);
}

function updateClocks(now) {
    const currentSec = now.getSeconds();
    if (currentSec !== lastClockSec) {
        lastClockSec = currentSec;
        document.getElementById('clock-local').innerText = now.toLocaleTimeString();
        document.getElementById('clock-utc').innerText = now.toISOString().substring(11, 19) + " UTC";
    }
}

function propagateOrbits(now) {
    const gmst = satellite.gstime(now);
    
    // Observer coordinates in radians
    const obsGdRad = {
        latitude: satellite.degreesToRadians(state.observer.lat),
        longitude: satellite.degreesToRadians(state.observer.lon),
        height: state.observer.alt // in km
    };

    state.satellites.forEach(sat => {
        try {
            // Propagate satellite position
            const positionEci = satellite.propagate(sat.satrec, now);
            
            if (positionEci && positionEci.position) {
                // Save ECF position
                const ecfPos = satellite.eciToEcf(positionEci.position, gmst);
                sat.positionEcf = ecfPos;
                
                // Get Geodetic ground track
                const gdPos = satellite.eciToGeodetic(positionEci.position, gmst);
                sat.positionGd = {
                    latitude: satellite.radiansToDegrees(gdPos.latitude),
                    longitude: satellite.radiansToDegrees(gdPos.longitude),
                    height: gdPos.height // in km
                };

                // Get local look angles
                const look = satellite.ecfToLookAngles(obsGdRad, ecfPos);
                sat.lookAngles = {
                    azimuth: look.azimuth, // in rad
                    elevation: look.elevation, // in rad
                    rangeSat: look.rangeSat // in km
                };

                // Elevation > 0 means the satellite is above the observer's horizon
                sat.visible = look.elevation > 0;
            } else {
                sat.visible = false;
                sat.positionEcf = null;
            }
        } catch (err) {
            sat.visible = false;
            sat.positionEcf = null;
        }
    });
}



// --- ACTIVE SATELLITE SELECTION ---
function selectSatellite(sat) {
    state.selectedSat = sat;
    
    // Build floating inspector panel
    const panel = document.getElementById('sat-inspector');
    panel.classList.remove('hidden');
    
    document.getElementById('inspect-name').innerText = sat.name;
    document.getElementById('inspect-norad').innerText = sat.noradId;
    document.getElementById('inspect-period').innerText = `${sat.period.toFixed(1)} min`;





    // Render its orbit trail line in 3D globe and sky immediately
    if (state.orbitTrailVisible) {
        generateOrbitTrail(sat);
        generateSkyOrbitTrail(sat);
    }
}

function updateInspectorPanel() {
    if (!state.selectedSat) return;
    
    const now = new Date();
    const nowMs = now.getTime();
    
    // Throttle the inspector panel updates to ~6.6 updates per second (every 150ms)
    // to prevent heavy DOM reflows and eliminate repaint lag in the layout.
    if (nowMs - lastInspectorUpdate < 150) return;
    lastInspectorUpdate = nowMs;
    
    // Find the latest state values for our selected satellite
    const sat = state.satellites.find(s => s.noradId === state.selectedSat.noradId);
    if (!sat) return;
    
    const elevDeg = satellite.radiansToDegrees(sat.lookAngles.elevation);
    const azimDeg = satellite.radiansToDegrees(sat.lookAngles.azimuth);
    const range = sat.lookAngles.rangeSat;
    const altitude = sat.positionGd.height;
    
    // Speed calculation using basic ECI orbital physics or delta-V (approximate live orbital speed)
    // LEO speeds are around 7.5 to 7.8 km/s depending on altitude
    const G = 3.986004418e5; // Earth gravitational parameter km^3/s^2
    const orbitalRadius = 6371 + altitude; // km
    const speedKms = Math.sqrt(G / orbitalRadius);
    
    // Coordinate conversion description
    const statusText = document.getElementById('inspect-horizon-status');
    const boxElev = document.getElementById('inspect-elev').parentElement;
    
    document.getElementById('inspect-elev').innerText = `${elevDeg.toFixed(1)}°`;
    document.getElementById('inspect-azim').innerText = `${azimDeg.toFixed(1)}°`;
    document.getElementById('inspect-range').innerText = `${Math.round(range).toLocaleString()} km`;
    document.getElementById('inspect-alt').innerText = `${Math.round(altitude).toLocaleString()} km`;
    document.getElementById('inspect-speed').innerText = `${speedKms.toFixed(2)} km/s`;
    document.getElementById('inspect-latlon').innerText = `${Math.abs(sat.positionGd.latitude).toFixed(2)}° ${sat.positionGd.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(sat.positionGd.longitude).toFixed(2)}° ${sat.positionGd.longitude >= 0 ? 'E' : 'W'}`;
    

    
    // Display Horizon states
    if (sat.visible) {
        statusText.innerText = "Above Horizon";
        statusText.style.color = varColor('green');
        boxElev.style.borderColor = 'rgba(0, 255, 102, 0.2)';
    } else {
        statusText.innerText = "Below Horizon (Set)";
        statusText.style.color = varColor('warning');
        boxElev.style.borderColor = 'rgba(255, 51, 102, 0.2)';
    }

    // Display Cardinal Compass Direction
    const directions = [
        { name: "North", abbr: "N", min: 348.75, max: 11.25 },
        { name: "North-Northeast", abbr: "NNE", min: 11.25, max: 33.75 },
        { name: "Northeast", abbr: "NE", min: 33.75, max: 56.25 },
        { name: "East-Northeast", abbr: "ENE", min: 56.25, max: 78.75 },
        { name: "East", abbr: "E", min: 78.75, max: 101.25 },
        { name: "East-Southeast", abbr: "ESE", min: 101.25, max: 123.75 },
        { name: "Southeast", abbr: "SE", min: 123.75, max: 146.25 },
        { name: "South-Southeast", abbr: "SSE", min: 146.25, max: 168.75 },
        { name: "South", abbr: "S", min: 168.75, max: 191.25 },
        { name: "South-Southwest", abbr: "SSW", min: 191.25, max: 213.75 },
        { name: "Southwest", abbr: "SW", min: 213.75, max: 236.25 },
        { name: "West-Southwest", abbr: "WSW", min: 236.25, max: 258.75 },
        { name: "West", abbr: "W", min: 258.75, max: 281.25 },
        { name: "West-Northwest", abbr: "WNW", min: 281.25, max: 303.75 },
        { name: "Northwest", abbr: "NW", min: 303.75, max: 326.25 },
        { name: "North-Northwest", abbr: "NNW", min: 326.25, max: 348.75 }
    ];

    let matchedDir = "North (N)";
    for (let d of directions) {
        if (d.min > d.max) { // Overlaps 360° mark
            if (azimDeg >= d.min || azimDeg < d.max) {
                matchedDir = `${d.name} (${d.abbr})`;
                break;
            }
        } else {
            if (azimDeg >= d.min && azimDeg < d.max) {
                matchedDir = `${d.name} (${d.abbr})`;
                break;
            }
        }
    }
    document.getElementById('inspect-quadrant').innerText = matchedDir;

    // Check if the satellite is in Sunlight (rough estimation: not shadowed by Earth)
    // A satellite in LEO is eclipsed if it lies in the conical shadow of Earth.
    // For visual tracker, a simplified calculation is:
    // If it's daytime at the satellite's ground track, it is definitely sunlit.
    // If it's night at ground track, it might still be sunlit because of its high altitude!
    // We will estimate it using a simplified elevation of the Sun at that longitude:
    // This adds a premium scientific touch.
    const day = now.getUTCDate();
    const month = now.getUTCMonth();
    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    
    // Very simple sun longitude estimation based on hour of day
    // Sun is overhead at longitude = 180 - (UTC_Hour + UTC_Min/60) * 15
    const sunLon = 180 - (hour + min/60) * 15;
    
    // Angular distance between satellite ground track and subsolar point
    // If angular distance < 110 degrees, the satellite is high enough to catch sunlight!
    const satLatRad = satellite.degreesToRadians(sat.positionGd.latitude);
    const satLonRad = satellite.degreesToRadians(sat.positionGd.longitude);
    const sunLonRad = satellite.degreesToRadians(sunLon);
    
    // Sun declination is roughly 0 (near Equator in spring)
    const angularDist = Math.acos(Math.sin(satLatRad) * 0 + Math.cos(satLatRad) * 1 * Math.cos(satLonRad - sunLonRad));
    const isSunlit = angularDist < (Math.PI / 2 + 0.35); // 0.35 radians allows high alt sunlight coverage!
    
    const sunlightEl = document.getElementById('inspect-sunlight');
    if (isSunlit) {
        sunlightEl.innerHTML = '<i class="fa-solid fa-sun text-yellow"></i> Sunlit (Reflective)';
        sunlightEl.className = "text-yellow";
    } else {
        sunlightEl.innerHTML = '<i class="fa-solid fa-moon text-muted"></i> Eclipsed (Shadow)';
        sunlightEl.className = "text-muted";
    }
}
