// Application state
const state = {
    connectionStatus: 'demo', // 'demo', 'connecting', 'connected'
    espIp: 'http://192.168.1.50',
    aiUrl: 'http://localhost:5000',
    pollInterval: 2000,
    pollTimer: null,
    
    // Telemetry
    telemetry: {
        voltage: 12.4,
        current: 2.1,
        power: 26.04,
        battery_soc: 78,
        mosfet_temperature: 38.5,
        battery_temperature: 32.1,
        charging: true,
        mosfet_status: 'ON',
        source_status: 'CONNECTED',
        safety_status: 'NOMINAL',
        runtime: 0,
        wifi_rssi: -62,
        sensor_status: 'ACTIVE',
        health_pct: 97.4,
        impedance_mohm: 42,
        cycles: 104
    },
    
    // Limits / Thresholds
    thresholds: {
        max_v: 16.0,
        min_v: 9.6,
        max_i: 10.0,
        max_mosfet_temp: 75,
        max_batt_temp: 50,
        low_soc: 15
    },
    
    // Active controls
    control: {
        mode: 'charge',
        pwm: 35,
        vLimit: 14.4,
        iLimit: 5.0,
        safetyUnlocked: false,
        gateState: 'ON'
    },
    
    // Historical trends for charts
    history: {
        timestamps: [],
        voltage: [],
        current: [],
        power: [],
        mosfet_temp: [],
        battery_temp: [],
        battery_soh: []
    },
    
    // Diagnostics Logs for AI Terminal
    aiLogs: [
        { time: '17:38:00', type: 'SYS', msg: 'Initializing telemetry analyzer client socket...' },
        { time: '17:38:01', type: 'SYS', msg: 'Active telemetry stream: Listening on local simulation bus.' }
    ],
    
    // AI connection indicator
    aiConnected: false,
    consecutiveFailures: 0
};

// Chart instances
let chartVoltageCurrent = null;
let chartPowerTemp = null;
let chartBatteryHistory = null;

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initSliders();
    initCharts();
    setupEventHandlers();
    
    // Start Polling Loop
    startPolling();
    
    // Generate initial history points
    generateInitialHistory();
});

// Sidebar Navigation Tab Switching
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const pagePanels = document.querySelectorAll('.page-panel');
    const mobileToggle = document.getElementById('mobile-toggle');
    const sidebar = document.getElementById('sidebar');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = item.getAttribute('data-page');
            
            // Update active state in sidebar
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Show target panel
            pagePanels.forEach(panel => {
                panel.classList.remove('active');
                if (panel.id === `page-${targetPage}`) {
                    panel.classList.add('active');
                }
            });

            // Update header text based on page
            updateHeaderTitle(targetPage);

            // Close sidebar on mobile
            sidebar.classList.remove('mobile-open');
        });
    });

    mobileToggle.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
    });
}

function updateHeaderTitle(page) {
    const titleDisp = document.getElementById('page-title-display');
    const subtitleDisp = document.getElementById('page-subtitle-display');
    
    const titles = {
        'overview': { title: 'Overview Dashboard', sub: 'Real-time telemetry of power converters' },
        'control': { title: 'Bidirectional Power Control', sub: 'Adjust switching modes, duty cycle, and voltage limit boundaries' },
        'battery': { title: 'Battery Energy Storage System', sub: 'Internal pack health parameters, state of charge, and cycling details' },
        'ai-analysis': { title: 'AI Predictive Diagnostic Center', sub: 'Machine learning anomaly classification and preventive diagnostics' },
        'settings': { title: 'IoT Connections & System Settings', sub: 'Configure ESP32 network link parameters and safety trigger limits' }
    };

    if (titles[page]) {
        titleDisp.textContent = titles[page].title;
        subtitleDisp.textContent = titles[page].sub;
    }
}

// Slider readouts & interlocks
function initSliders() {
    const pwmSlider = document.getElementById('slider-pwm');
    const pwmReadout = document.getElementById('readout-pwm');
    const vLimitSlider = document.getElementById('slider-v-limit');
    const vLimitReadout = document.getElementById('readout-v-limit');
    const iLimitSlider = document.getElementById('slider-i-limit');
    const iLimitReadout = document.getElementById('readout-i-limit');
    const safetyCheck = document.getElementById('safety-disclaimer-check');
    const applyBtn = document.getElementById('btn-apply-control');

    pwmSlider.addEventListener('input', () => {
        pwmReadout.textContent = `${pwmSlider.value}%`;
        state.control.pwm = parseInt(pwmSlider.value);
    });

    vLimitSlider.addEventListener('input', () => {
        vLimitReadout.textContent = `${parseFloat(vLimitSlider.value).toFixed(1)} V`;
        state.control.vLimit = parseFloat(vLimitSlider.value);
    });

    iLimitSlider.addEventListener('input', () => {
        iLimitReadout.textContent = `${parseFloat(iLimitSlider.value).toFixed(1)} A`;
        state.control.iLimit = parseFloat(iLimitSlider.value);
    });

    // Safety Interlock Unlock sequence
    safetyCheck.addEventListener('change', () => {
        const checked = safetyCheck.checked;
        state.control.safetyUnlocked = checked;
        
        pwmSlider.disabled = !checked;
        vLimitSlider.disabled = !checked;
        iLimitSlider.disabled = !checked;
        applyBtn.disabled = !checked;

        if (checked) {
            logConsole('SYS', 'Safety interlock unlocked. User authorized switching modifications.', 'warn');
        } else {
            logConsole('SYS', 'Safety interlock locked. Controls restricted.', 'info');
        }
    });
}

// Chart.js Configuration
function initCharts() {
    const ctx1 = document.getElementById('chart-voltage-current').getContext('2d');
    const ctx2 = document.getElementById('chart-power-temp').getContext('2d');
    const ctx3 = document.getElementById('chart-battery-history').getContext('2d');

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.04)' },
                ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
            },
            y: {
                grid: { color: 'rgba(255, 255, 255, 0.04)' },
                ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
            }
        },
        plugins: {
            legend: {
                labels: { color: '#f3f4f6', font: { family: 'Outfit', size: 11 } }
            }
        }
    };

    chartVoltageCurrent = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: state.history.timestamps,
            datasets: [
                {
                    label: 'Voltage (V)',
                    data: state.history.voltage,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'Current (A)',
                    data: state.history.current,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                x: commonOptions.scales.x,
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: commonOptions.scales.y.grid,
                    ticks: commonOptions.scales.y.ticks,
                    title: { display: true, text: 'Voltage (V)', color: '#3b82f6' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: commonOptions.scales.y.ticks,
                    title: { display: true, text: 'Current (A)', color: '#10b981' }
                }
            }
        }
    });

    chartPowerTemp = new Chart(ctx2, {
        type: 'line',
        data: {
            labels: state.history.timestamps,
            datasets: [
                {
                    label: 'Power (W)',
                    data: state.history.power,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'MOSFET Temp (°C)',
                    data: state.history.mosfet_temp,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y1'
                },
                {
                    label: 'Battery Temp (°C)',
                    data: state.history.battery_temp,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                x: commonOptions.scales.x,
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: commonOptions.scales.y.grid,
                    ticks: commonOptions.scales.y.ticks,
                    title: { display: true, text: 'Power (W)', color: '#f59e0b' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: commonOptions.scales.y.ticks,
                    title: { display: true, text: 'Temperature (°C)', color: '#ef4444' }
                }
            }
        }
    });

    chartBatteryHistory = new Chart(ctx3, {
        type: 'line',
        data: {
            labels: state.history.timestamps,
            datasets: [
                {
                    label: 'Battery Temp (°C)',
                    data: state.history.battery_temp,
                    borderColor: '#06b6d4',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false
                },
                {
                    label: 'State of Health (%)',
                    data: state.history.battery_soh,
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    tension: 0.1,
                    fill: false
                }
            ]
        },
        options: commonOptions
    });
}

// Generate starting mock points
function generateInitialHistory() {
    const now = new Date();
    for (let i = 15; i >= 0; i--) {
        const timeVal = new Date(now.getTime() - i * 4000);
        const timeStr = timeVal.toTimeString().split(' ')[0];
        
        state.history.timestamps.push(timeStr);
        state.history.voltage.push(12.2 + Math.random() * 0.4);
        state.history.current.push(1.5 + Math.random() * 0.8);
        state.history.power.push(18.0 + Math.random() * 5);
        state.history.mosfet_temp.push(35.2 + Math.random() * 2);
        state.history.battery_temp.push(29.8 + Math.random() * 0.5);
        state.history.battery_soh.push(state.telemetry.health_pct);
    }
    updateCharts();
}

function updateCharts() {
    if (chartVoltageCurrent) chartVoltageCurrent.update();
    if (chartPowerTemp) chartPowerTemp.update();
    if (chartBatteryHistory) chartBatteryHistory.update();
}

// Button actions, inputs configuration
function setupEventHandlers() {
    // Connect to ESP32
    document.getElementById('btn-esp-connect').addEventListener('click', toggleEspConnection);
    
    // Save Network Configuration
    document.getElementById('btn-save-network').addEventListener('click', () => {
        let ipInput = document.getElementById('settings-ip-address').value.trim();
        let aiInput = document.getElementById('settings-ai-address').value.trim();
        const refreshRate = parseInt(document.getElementById('settings-refresh').value);
        
        if (ipInput && !ipInput.startsWith('http://') && !ipInput.startsWith('https://')) {
            ipInput = 'http://' + ipInput;
        }
        if (aiInput && !aiInput.startsWith('http://') && !aiInput.startsWith('https://')) {
            aiInput = 'http://' + aiInput;
        }

        state.espIp = ipInput;
        state.aiUrl = aiInput;
        state.pollInterval = refreshRate;
        
        // Synchronize top IP bar
        document.getElementById('esp-ip-address').value = ipInput;
        document.getElementById('settings-ip-address').value = ipInput;
        document.getElementById('settings-ai-address').value = aiInput;

        logConsole('SYS', `Settings saved. Poll rate: ${refreshRate}ms. AI Endpoint: ${aiInput}`, 'info');
        alert('Settings updated successfully.');
        
        // Re-start polling with new frequency
        startPolling();
    });

    // Reset Links
    document.getElementById('btn-reset-connection').addEventListener('click', () => {
        state.connectionStatus = 'demo';
        state.consecutiveFailures = 0;
        document.getElementById('settings-ip-address').value = 'http://192.168.1.50';
        document.getElementById('esp-ip-address').value = 'http://192.168.1.50';
        document.getElementById('settings-ai-address').value = 'http://localhost:5000';
        
        updateConnectionUI();
        logConsole('SYS', 'Connection links reset. Simulation mode active.', 'info');
    });

    // E-Stop Logic
    const estopBtn = document.getElementById('btn-global-estop');
    estopBtn.addEventListener('click', triggerEmergencyStop);

    // Apply Control Config
    document.getElementById('btn-apply-control').addEventListener('click', applyPowerControlConfig);

    // Threshold upload Configs
    document.getElementById('btn-save-thresholds').addEventListener('click', uploadProtectionLimits);
}

// ESP32 IP Link Toggle
void toggleEspConnection() {
    // JS equivalent
}
function toggleEspConnection() {
    if (state.connectionStatus === 'connected' || state.connectionStatus === 'connecting') {
        // Disconnect
        state.connectionStatus = 'demo';
        state.consecutiveFailures = 0;
        updateConnectionUI();
        logConsole('SYS', 'User requested disconnect. Demo Mode initialized.', 'info');
    } else {
        // Try Connect
        let ipVal = document.getElementById('esp-ip-address').value.trim();
        if (!ipVal) {
            alert('Please enter a valid IP address or hostname.');
            return;
        }
        if (!ipVal.startsWith('http://') && !ipVal.startsWith('https://')) {
            ipVal = 'http://' + ipVal;
        }
        state.espIp = ipVal;
        document.getElementById('esp-ip-address').value = ipVal; // Update display to show prefix
        
        state.connectionStatus = 'connecting';
        updateConnectionUI();
        logConsole('SYS', `Attempting link to hardware REST API at: ${state.espIp}`, 'info');
        
        // Attempt a quick health ping fetch
        fetch(`${state.espIp}/api/status`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP Error Status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                state.connectionStatus = 'connected';
                state.consecutiveFailures = 0;
                logConsole('SYS', `Link handshake completed. Wi-Fi RSSI: ${data.wifi_rssi}dBm. Device Online.`, 'ok');
                updateConnectionUI();
            })
            .catch(err => {
                console.error(err);
                state.connectionStatus = 'demo';
                updateConnectionUI();
                logConsole('SYS', `Handshake failed: ${err.message}. Remote target offline.`, 'crit');
                alert(`Connection failed!\n\nError details: ${err.message}\n\n1. Confirm the ESP32 is powered on.\n2. Ensure your PC and the ESP32 are connected to the EXACT SAME Wi-Fi network.\n3. Verify the IP address typed in the dashboard matches the ESP32 serial monitor.`);
            });
    }
}

// Emergency stop logic (Fail-Safe shut off)
function triggerEmergencyStop() {
    // Immediately disable on frontend for safety
    state.control.gateState = 'OFF';
    state.control.pwm = 0;
    state.telemetry.mosfet_status = 'OFF';
    
    // Update inputs
    document.getElementById('slider-pwm').value = 0;
    document.getElementById('readout-pwm').textContent = '0%';
    
    logConsole('SYS', 'EMERGENCY SHUTDOWN ACTIVATED! MOSFET gates disabled.', 'crit');
    
    // Force UI visual updates instantly
    document.getElementById('diag-gate-sw-state').className = 'diagnostic-value-pill danger-state';
    document.getElementById('diag-gate-sw-state').textContent = 'OFF';
    document.getElementById('status-text-mosfet').textContent = 'DISABLED';
    document.getElementById('status-badge-mosfet').style.backgroundColor = 'var(--color-danger)';
    
    // Disable flow line animation
    document.getElementById('flow-source-conv').className.baseVal = 'flow-line flow-inactive';
    document.getElementById('flow-conv-batt').className.baseVal = 'flow-line flow-inactive';
    
    // Toggle nodes back to inactive state
    document.getElementById('node-source').className.baseVal = 'node-group';
    document.getElementById('node-converter').className.baseVal = 'node-group';
    document.getElementById('node-battery').className.baseVal = 'node-group';
    document.getElementById('diag-mosfet-status').textContent = 'OFF';

    if (state.connectionStatus === 'connected') {
        const controllerEndpoint = `${state.espIp}/api/control`;
        fetch(controllerEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estop: true })
        })
        .then(res => {
            if (!res.ok) throw new Error('ESTOP transmission failed');
            return res.json();
        })
        .then(data => {
            logConsole('SYS', 'ESP32 confirmed hardware-level E-Stop triggered.', 'ok');
        })
        .catch(err => {
            logConsole('SYS', `E-Stop REST command failure: ${err.message}. Ensure hardware power switch manual shutdown!`, 'crit');
        });
    } else {
        alert('EMERGENCY STOP TRIGGERED (SIMULATION)');
    }
}

// Upload Protection bounds to ESP32
function uploadProtectionLimits() {
    const maxV = parseFloat(document.getElementById('threshold-max-v').value);
    const minV = parseFloat(document.getElementById('threshold-min-v').value);
    const maxI = parseFloat(document.getElementById('threshold-max-i').value);
    const maxMosTemp = parseInt(document.getElementById('threshold-max-mosfet-temp').value);
    const maxBattTemp = parseInt(document.getElementById('threshold-max-batt-temp').value);
    const lowSoc = parseInt(document.getElementById('threshold-critical-soc').value);

    // Save locally
    state.thresholds = { max_v: maxV, min_v: minV, max_i: maxI, max_mosfet_temp: maxMosTemp, max_batt_temp: maxBattTemp, low_soc: lowSoc };
    logConsole('SYS', `Local protection boundaries updated. Uploading to board config EEPROM...`, 'info');

    if (state.connectionStatus === 'connected') {
        fetch(`${state.espIp}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.thresholds)
        })
        .then(res => {
            if (!res.ok) throw new Error('Configuration push failed');
            return res.json();
        })
        .then(data => {
            logConsole('SYS', 'ESP32 config update acknowledged. Limits stored.', 'ok');
            alert('Hardware safety bounds uploaded successfully.');
        })
        .catch(err => {
            logConsole('SYS', `Config push failed: ${err.message}. Retrying...`, 'crit');
            alert('Error pushing safety limits to ESP32 API.');
        });
    } else {
        logConsole('SYS', 'Safety limits synced in local memory simulation (Demo Mode).', 'ok');
        alert('Limits updated locally in Demo Mode.');
    }
}

// Apply duty cycle and limits changes
function applyPowerControlConfig() {
    const selectedMode = document.querySelector('input[name="power-mode"]:checked').value;
    state.control.mode = selectedMode;
    
    // Enable switching gates based on PWM
    state.control.gateState = (state.control.pwm > 0) ? 'ON' : 'OFF';

    logConsole('SYS', `Pushing Converter Gate command: Mode=${selectedMode.toUpperCase()} PWM=${state.control.pwm}% V_Limit=${state.control.vLimit}V`, 'info');

    if (state.connectionStatus === 'connected') {
        const payload = {
            mode: state.control.mode,
            pwm: state.control.pwm,
            vLimit: state.control.vLimit,
            iLimit: state.control.iLimit,
            mosfet_status: state.control.gateState
        };

        fetch(`${state.espIp}/api/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => {
            if (!res.ok) throw new Error('Control transmission failed');
            return res.json();
        })
        .then(data => {
            logConsole('SYS', `ESP32 Control Loop Sync: Gate status: ${data.mosfet_status}`, 'ok');
            // update local representation
            state.telemetry.mosfet_status = data.mosfet_status;
        })
        .catch(err => {
            logConsole('SYS', `Control push failed: ${err.message}`, 'crit');
            alert('Error writing parameters to ESP32 REST controller.');
        });
    } else {
        // Mock simulation behavior changes
        state.telemetry.mosfet_status = state.control.gateState;
        state.telemetry.charging = (selectedMode === 'charge' || (selectedMode === 'bidirectional' && Math.random() > 0.5));
        
        logConsole('SYS', `Simulation parameters applied. MOSFET gate switching: ${state.control.gateState}`, 'ok');
        alert('Control parameters applied in Demo Mode.');
    }
}

// Start polling sequence
function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(pollLoop, state.pollInterval);
}

// Core Loop
function pollLoop() {
    if (state.connectionStatus === 'connected') {
        fetchTelemetryData();
    } else {
        runDemoSimulation();
    }
    
    // Fetch AI Analysis telemetry
    pushTelemetryToAIBackend();
}

// Fetch from physical board
function fetchTelemetryData() {
    const startPing = Date.now();
    fetch(`${state.espIp}/api/data`)
        .then(res => {
            if (!res.ok) throw new Error('Error retrieving telemetry JSON');
            return res.json();
        })
        .then(data => {
            state.consecutiveFailures = 0;
            state.telemetry = { ...state.telemetry, ...data };
            
            // Log ping latency
            const latency = Date.now() - startPing;
            document.getElementById('diag-api-latency').textContent = `${latency} ms`;
            document.getElementById('diag-api-latency').style.color = 'var(--color-success)';

            // Retrieve configuration status details
            return fetch(`${state.espIp}/api/status`);
        })
        .then(res => {
            if (res && res.ok) return res.json();
            return null;
        })
        .then(statusData => {
            if (statusData) {
                state.telemetry.wifi_rssi = statusData.wifi_rssi;
                state.telemetry.sensor_status = statusData.sensor_status;
                state.telemetry.safety_status = statusData.safety_status;
                state.telemetry.runtime = statusData.runtime;

                // Sync configs to indicators
                document.getElementById('diag-wifi-rssi').textContent = `${statusData.wifi_rssi} dBm`;
                document.getElementById('diag-sensors-probe').textContent = statusData.sensor_status;
                document.getElementById('diag-sensors-probe').style.color = (statusData.sensor_status === 'ACTIVE') ? 'var(--color-success)' : 'var(--color-danger)';
            }
            updateTelemetryUI();
        })
        .catch(err => {
            console.error(err);
            state.consecutiveFailures++;
            logConsole('SYS', `Data fetch failure count: ${state.consecutiveFailures}`, 'warn');
            
            if (state.consecutiveFailures >= 3) {
                state.connectionStatus = 'demo';
                updateConnectionUI();
                logConsole('SYS', 'Telemetry connection drop. Automatic failback to Demo Mode.', 'crit');
            }
        });
}

// Generate realistic simulated readings
function runDemoSimulation() {
    // Simulate battery state drifts based on current controls
    const isGateOn = state.telemetry.mosfet_status === 'ON';
    const isCharging = state.control.mode === 'charge';
    const isDischarging = state.control.mode === 'discharge';
    const isBidirectional = state.control.mode === 'bidirectional';
    const currentPwm = state.control.pwm;

    // Standard baseline adjustments
    let newI = 0.0;
    let newV = state.telemetry.voltage;
    let newSOC = state.telemetry.battery_soc;
    let newMosTemp = state.telemetry.mosfet_temperature;
    let newBattTemp = state.telemetry.battery_temperature;

    // Safety checks simulation
    let safetyCode = 'NOMINAL';

    // Source Status
    if (isCharging || isBidirectional) {
        state.telemetry.source_status = 'CONNECTED';
    } else {
        state.telemetry.source_status = 'CONNECTED'; // standard solar panel is always there
    }

    if (isGateOn) {
        // Calculate switching currents based on PWM
        const activeCurrentCapacity = (currentPwm / 100) * state.control.iLimit;
        
        if (isCharging) {
            newI = activeCurrentCapacity + (Math.random() - 0.5) * 0.1;
            newV += (newI * 0.02) + (Math.random() - 0.5) * 0.05;
            newSOC += (newI * 0.005);
            newMosTemp += (newI * 0.15) - 0.05; // heats up based on current
            newBattTemp += (newI * 0.04) - 0.01;
        } else if (isDischarging) {
            newI = -activeCurrentCapacity + (Math.random() - 0.5) * 0.1;
            newV += (newI * 0.025) + (Math.random() - 0.5) * 0.05;
            newSOC += (newI * 0.005);
            newMosTemp += (Math.abs(newI) * 0.18) - 0.05;
            newBattTemp += (Math.abs(newI) * 0.06) - 0.01;
        } else if (isBidirectional) {
            // alternates current flow
            const wave = Math.sin(Date.now() / 15000);
            newI = activeCurrentCapacity * wave;
            newV += (newI * 0.02) + (Math.random() - 0.5) * 0.05;
            newSOC += (newI * 0.005);
            newMosTemp += (Math.abs(newI) * 0.16) - 0.05;
            newBattTemp += (Math.abs(newI) * 0.05) - 0.01;
        }
    } else {
        // No switching, slow cooling
        newI = 0.0;
        newV += (12.4 - newV) * 0.05; // settles to float voltage
        newMosTemp -= 0.15; // cooling towards ambient
        newBattTemp -= 0.03;
    }

    // Cooling Fan dynamics
    const fanSpeedVal = document.getElementById('diag-fan-speed');
    if (newMosTemp > 35) {
        newMosTemp -= (newMosTemp - 30) * 0.02; // fan effect
        if (newMosTemp > 50) {
            fanSpeedVal.textContent = 'HIGH (100%)';
            fanSpeedVal.className = 'diagnostic-value-pill danger-state';
        } else {
            fanSpeedVal.textContent = 'LOW (45%)';
            fanSpeedVal.className = 'diagnostic-value-pill active-state';
        }
    } else {
        fanSpeedVal.textContent = 'OFF (0%)';
        fanSpeedVal.className = 'diagnostic-value-pill';
    }

    // Boundary constraints clamp
    if (newMosTemp < 27.5) newMosTemp = 27.5 + Math.random() * 0.2;
    if (newBattTemp < 26.5) newBattTemp = 26.5 + Math.random() * 0.2;
    if (newSOC > 100) newSOC = 100;
    if (newSOC < 0) newSOC = 0;

    // Safety checks logic based on thresholds
    if (newV > state.thresholds.max_v) {
        safetyCode = 'OVER_VOLTAGE';
        logConsole('SYS', `Safety Core protection triggered: V=${newV.toFixed(2)}V exceeds limit ${state.thresholds.max_v}V. Gate shutdown!`, 'crit');
        state.telemetry.mosfet_status = 'OFF';
        state.control.gateState = 'OFF';
    } else if (newV < state.thresholds.min_v) {
        safetyCode = 'UNDER_VOLTAGE';
    } else if (Math.abs(newI) > state.thresholds.max_i) {
        safetyCode = 'OVER_CURRENT';
        logConsole('SYS', `Safety Core protection triggered: Current over safety bounds! Gate shutdown.`, 'crit');
        state.telemetry.mosfet_status = 'OFF';
        state.control.gateState = 'OFF';
    } else if (newMosTemp > state.thresholds.max_mosfet_temp) {
        safetyCode = 'OVER_TEMP_MOSFET';
        logConsole('SYS', `Critical MOSFET Thermal threshold breached: T_mos=${newMosTemp.toFixed(1)}°C. Emergency shutdown active.`, 'crit');
        state.telemetry.mosfet_status = 'OFF';
        state.control.gateState = 'OFF';
    }

    // Pack health degradation based on cycles
    state.telemetry.cycles = 104 + Math.floor(state.telemetry.runtime / 60);

    // Save to state
    state.telemetry.voltage = parseFloat(newV.toFixed(2));
    state.telemetry.current = parseFloat(newI.toFixed(2));
    state.telemetry.power = parseFloat((state.telemetry.voltage * Math.abs(state.telemetry.current)).toFixed(2));
    state.telemetry.battery_soc = Math.round(newSOC);
    state.telemetry.mosfet_temperature = parseFloat(newMosTemp.toFixed(1));
    state.telemetry.battery_temperature = parseFloat(newBattTemp.toFixed(1));
    state.telemetry.charging = (newI > 0.05);
    state.telemetry.safety_status = safetyCode;
    state.telemetry.runtime += Math.round(state.pollInterval / 1000);

    // Sync mock indicators in settings tab
    document.getElementById('diag-wifi-rssi').textContent = '-45 dBm';
    document.getElementById('diag-sensors-probe').textContent = 'ACTIVE';
    document.getElementById('diag-sensors-probe').style.color = 'var(--color-success)';
    document.getElementById('diag-api-latency').textContent = '1 ms (Mock)';
    document.getElementById('diag-api-latency').style.color = 'var(--color-neutral)';

    updateTelemetryUI();
}

// Push to AI microservice flask backend
function pushTelemetryToAIBackend() {
    const aiTarget = `${state.aiUrl}/api/analyze`;
    
    // Prepare telemetry packet
    const payload = {
        voltage: state.telemetry.voltage,
        current: state.telemetry.current,
        power: state.telemetry.power,
        battery_soc: state.telemetry.battery_soc,
        mosfet_temperature: state.telemetry.mosfet_temperature,
        battery_temperature: state.telemetry.battery_temperature,
        charging: state.telemetry.charging,
        mosfet_status: state.telemetry.mosfet_status,
        source_status: state.telemetry.source_status,
        safety_status: state.telemetry.safety_status,
        runtime: state.telemetry.runtime,
        health_pct: state.telemetry.health_pct,
        impedance_mohm: state.telemetry.impedance_mohm,
        cycles: state.telemetry.cycles
    };

    fetch(aiTarget, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error('AI backend returned error code');
        return res.json();
    })
    .then(aiReport => {
        state.aiConnected = true;
        updateAIStatusUI(true);
        renderAIReport(aiReport);
    })
    .catch(err => {
        // Fall back to rule-based classification locally
        state.aiConnected = false;
        updateAIStatusUI(false);
        runLocalRuleBasedDiagnostics();
    });
}

function updateAIStatusUI(connected) {
    const dot = document.getElementById('sidebar-ai-dot');
    const text = document.getElementById('sidebar-ai-text');
    const diagField = document.getElementById('diag-ai-connection');
    
    if (connected) {
        dot.className = 'status-dot active';
        text.textContent = 'ONLINE';
        if (diagField) {
            diagField.textContent = 'CONNECTED (REST)';
            diagField.style.color = 'var(--color-success)';
        }
    } else {
        dot.className = 'status-dot';
        text.textContent = 'OFFLINE';
        if (diagField) {
            diagField.textContent = 'OFFLINE (Fallback Active)';
            diagField.style.color = 'var(--color-warning)';
        }
    }
}

// Evaluate simple thresholds in browser if backend is offline
function runLocalRuleBasedDiagnostics() {
    const telemetry = state.telemetry;
    const thresholds = state.thresholds;

    let sysCond = 'HEALTHY';
    let vEval = 'Normal';
    let iEval = 'Normal';
    let mEval = 'Normal';
    let bEval = 'Normal';
    let anomalyScore = '1.5%';
    let riskLevel = 'LOW';
    let recommendation = 'No abnormal behavior detected. System operating bounds are within safe parameters. No maintenance required.';

    // Check MOSFET heat bounds
    if (telemetry.mosfet_temperature > 65) {
        sysCond = 'WARNING';
        mEval = 'Thermal Stress';
        riskLevel = 'MEDIUM';
        recommendation = 'MOSFET Temperature is elevated. Active fan cooling engaged. Verify heat sink mounting and thermal interface paste.';
        anomalyScore = '35.4%';
    } else if (telemetry.mosfet_temperature > thresholds.max_mosfet_temp) {
        sysCond = 'CRITICAL';
        mEval = 'OVERHEATING';
        riskLevel = 'HIGH';
        recommendation = 'CRITICAL OVERHEAT! MOSFET temperature exceeds hardware safety limit. Gate switching has been disabled. Inspect cooling fan function.';
        anomalyScore = '92.1%';
    }

    // Check Battery voltage thresholds
    if (telemetry.voltage < thresholds.min_v + 0.5) {
        sysCond = (sysCond === 'CRITICAL') ? 'CRITICAL' : 'WARNING';
        vEval = 'Under-voltage alert';
        riskLevel = (riskLevel === 'HIGH') ? 'HIGH' : 'MEDIUM';
        recommendation = 'Battery voltage is approaching low-cutoff safety threshold. Switch gate controller to CHARGING mode.';
        anomalyScore = '45.1%';
    } else if (telemetry.voltage > thresholds.max_v) {
        sysCond = 'CRITICAL';
        vEval = 'Over-voltage alert';
        riskLevel = 'HIGH';
        recommendation = 'Battery over-voltage protection limit breached. Switching disabled. Calibrate solar or DC power supplies.';
        anomalyScore = '88.5%';
    }

    // Check current limit boundaries
    if (Math.abs(telemetry.current) > thresholds.max_i - 1.0) {
        sysCond = (sysCond === 'CRITICAL') ? 'CRITICAL' : 'WARNING';
        iEval = 'High load current';
        riskLevel = (riskLevel === 'HIGH') ? 'HIGH' : 'MEDIUM';
        recommendation = 'Load current is close to fuse bounds limit. Reduce load demand or limit switching duty cycle.';
        anomalyScore = '50.2%';
    }

    const localReport = {
        system_condition: sysCond,
        voltage_evaluation: vEval,
        current_evaluation: iEval,
        mosfet_evaluation: mEval,
        battery_evaluation: bEval,
        anomaly_score: anomalyScore,
        risk_level: riskLevel,
        recommendation: recommendation,
        is_local_fallback: true
    };

    renderAIReport(localReport);
}

// Render generated or fetched reports on Page 4
function renderAIReport(report) {
    // Report cards updates
    const condField = document.getElementById('ai-system-cond');
    const vField = document.getElementById('ai-voltage-cond');
    const iField = document.getElementById('ai-current-cond');
    const mField = document.getElementById('ai-mosfet-cond');
    const bField = document.getElementById('ai-battery-cond');
    const scoreField = document.getElementById('ai-failure-score');
    const riskField = document.getElementById('ai-risk-level');
    const recomField = document.getElementById('ai-maintenance-recom');

    condField.textContent = report.system_condition;
    condField.className = `ai-stat-val ${report.system_condition.toLowerCase()}`;
    
    vField.textContent = report.voltage_evaluation;
    iField.textContent = report.current_evaluation;
    mField.textContent = report.mosfet_evaluation;
    bField.textContent = report.battery_evaluation;
    
    scoreField.textContent = report.anomaly_score;
    // Set score colors based on score value
    const scoreNum = parseFloat(report.anomaly_score);
    if (scoreNum > 60) {
        scoreField.style.color = 'var(--color-danger)';
    } else if (scoreNum > 20) {
        scoreField.style.color = 'var(--color-warning)';
    } else {
        scoreField.style.color = 'var(--color-success)';
    }

    riskField.textContent = report.risk_level;
    riskField.className = `ai-stat-val ${report.risk_level.toLowerCase()}`;

    recomField.textContent = report.recommendation;

    // Terminal console logging
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    
    if (report.system_condition !== 'HEALTHY') {
        const warningType = (report.system_condition === 'CRITICAL') ? 'CRIT' : 'WARN';
        const cssClass = (report.system_condition === 'CRITICAL') ? 'status-tag-crit' : 'status-tag-warn';
        
        logConsole('SYS', `[DIAG] Anomalous behavior detected: V=${report.voltage_evaluation}, T_mos=${report.mosfet_evaluation}. Risk: ${report.risk_level}`, warningType);
    } else {
        // periodically log healthy heartbeat
        if (Math.random() > 0.85) {
            logConsole('SYS', 'Continuous predictive scan: All nodes nominal. Failure risk is negligible.', 'ok');
        }
    }
}

// Write to terminal UI on AI Analysis page
function logConsole(sender, message, type = 'info') {
    const consoleOut = document.getElementById('console-output');
    if (!consoleOut) return;

    const line = document.createElement('div');
    line.className = 'console-line';

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    let typeTag = '[SYS]';
    let typeClass = 'status-tag-info';
    
    if (type === 'ok') {
        typeTag = '[OK]';
        typeClass = 'status-tag-ok';
    } else if (type === 'warn') {
        typeTag = '[WARN]';
        typeClass = 'status-tag-warn';
    } else if (type === 'crit') {
        typeTag = '[CRIT]';
        typeClass = 'status-tag-crit';
    }

    line.innerHTML = `<span class="timestamp">[${timeStr}]</span><span class="${typeClass}">${typeTag}</span> ${message}`;
    
    consoleOut.appendChild(line);
    
    // Auto Scroll console
    consoleOut.scrollTop = consoleOut.scrollHeight;

    // Keep console line count reasonable
    while (consoleOut.children.length > 50) {
        consoleOut.removeChild(consoleOut.firstChild);
    }
}

// Sync variables to dashboard UI
function updateTelemetryUI() {
    const t = state.telemetry;

    // Direct stats indicators updates
    updateValWithTrend('kpi-voltage', 'trend-voltage', t.voltage, 'V');
    updateValWithTrend('kpi-current', 'trend-current', t.current, 'A');
    updateValWithTrend('kpi-power', 'trend-power', t.power, 'W');
    updateValWithTrend('kpi-soc', 'trend-soc', t.battery_soc, '%');
    updateValWithTrend('kpi-mosfet-temp', 'trend-mosfet-temp', t.mosfet_temperature, '°C');
    updateValWithTrend('kpi-battery-temp', 'trend-battery-temp', t.battery_temperature, '°C');

    // Sync Diagram nodes voltage and values
    document.getElementById('diag-source-v').textContent = `${(t.charging || state.control.mode === 'bidirectional') ? '15.2V' : '0.0V'}`;
    document.getElementById('diag-battery-soc').textContent = `${t.battery_soc}%`;
    document.getElementById('diag-mosfet-status').textContent = t.mosfet_status;
    document.getElementById('diag-mosfet-status').className = t.mosfet_status === 'ON' ? 'diagnostic-value-pill active-state' : 'diagnostic-value-pill danger-state';

    // Gate driver status pill in Controls tab
    const gatePill = document.getElementById('diag-gate-sw-state');
    gatePill.textContent = t.mosfet_status;
    gatePill.className = t.mosfet_status === 'ON' ? 'diagnostic-value-pill active-state' : 'diagnostic-value-pill danger-state';

    // Update Battery Tab specific UI values
    document.getElementById('battery-huge-soc').textContent = t.battery_soc;
    document.getElementById('diag-batt-power').textContent = `${t.power} W`;
    document.getElementById('diag-batt-cycles').textContent = `${t.cycles} cycles`;

    // Dynamic SOH calculation
    const calculatedSoh = (100 - (t.cycles * 0.025)).toFixed(1);
    state.telemetry.health_pct = calculatedSoh;
    document.getElementById('battery-health-pct').textContent = `${calculatedSoh}%`;
    
    // Status text details
    const modeText = document.getElementById('status-text-charge');
    const modeBadge = document.getElementById('status-badge-charge');
    const batteryStateText = document.getElementById('battery-huge-state');
    const batteryStatusTag = document.getElementById('battery-health-status');

    if (t.mosfet_status === 'ON') {
        if (state.control.mode === 'charge') {
            modeText.textContent = 'CHARGING';
            batteryStateText.textContent = 'CHARGING PACK';
            modeBadge.style.backgroundColor = 'var(--color-success)';
        } else if (state.control.mode === 'discharge') {
            modeText.textContent = 'DISCHARGING';
            batteryStateText.textContent = 'DISCHARGING';
            modeBadge.style.backgroundColor = 'var(--color-warning)';
        } else {
            modeText.textContent = 'BIDIRECTIONAL';
            batteryStateText.textContent = 'GRID INTERACTIVE';
            modeBadge.style.backgroundColor = 'var(--color-info)';
        }
    } else {
        modeText.textContent = 'IDLE';
        batteryStateText.textContent = 'IDLE';
        modeBadge.style.backgroundColor = 'var(--color-neutral)';
    }

    // Battery pack status checks
    const battStatusRow = document.getElementById('diag-batt-temp-status');
    if (t.battery_temperature > state.thresholds.max_batt_temp) {
        batteryStatusTag.textContent = 'CRITICAL';
        batteryStatusTag.className = 'battery-health-status-tag danger-state';
        battStatusRow.textContent = 'OVERHEATING';
        battStatusRow.className = 'ai-stat-val critical';
    } else if (t.battery_temperature > 40 || t.battery_soc < state.thresholds.low_soc) {
        batteryStatusTag.textContent = 'WARNING';
        batteryStatusTag.className = 'battery-health-status-tag warning-charge';
        battStatusRow.textContent = 'ELEVATED / LOW';
        battStatusRow.className = 'ai-stat-val warning';
    } else {
        batteryStatusTag.textContent = 'HEALTHY';
        batteryStatusTag.className = 'battery-health-status-tag';
        battStatusRow.textContent = 'NORMAL';
        battStatusRow.className = 'ai-stat-val healthy';
    }

    // Update Battery Graphic level & state colors
    const cellGraphic = document.getElementById('battery-cell-graphic');
    cellGraphic.style.height = `${t.battery_soc}%`;
    cellGraphic.className = 'battery-level-charge';
    if (t.battery_soc <= 15) {
        cellGraphic.classList.add('critical-charge');
    } else if (t.battery_soc <= 30) {
        cellGraphic.classList.add('warning-charge');
    }

    // Sync Source Status Badges
    const srcText = document.getElementById('status-text-source');
    const srcBadge = document.getElementById('status-badge-source');
    if (t.source_status === 'CONNECTED') {
        srcText.textContent = 'STABLE (15V)';
        srcBadge.style.backgroundColor = 'var(--color-success)';
    } else {
        srcText.textContent = 'DISCONNECTED';
        srcBadge.style.backgroundColor = 'var(--color-neutral)';
    }

    // MOSFET Gate status badge in quick panels
    const mosBadge = document.getElementById('status-badge-mosfet');
    const mosText = document.getElementById('status-text-mosfet');
    if (t.mosfet_status === 'ON') {
        mosText.textContent = 'SWITCHING';
        mosBadge.style.backgroundColor = 'var(--color-success)';
    } else {
        mosText.textContent = 'DISABLED';
        mosBadge.style.backgroundColor = 'var(--color-neutral)';
    }

    // Safety checks status badge
    const safetyBadge = document.getElementById('status-badge-safety');
    const safetyText = document.getElementById('status-text-safety');
    if (t.safety_status === 'NOMINAL') {
        safetyText.textContent = 'NOMINAL';
        safetyBadge.className = 'status-badge';
        safetyBadge.style.backgroundColor = 'var(--color-success)';
    } else {
        safetyText.textContent = t.safety_status;
        safetyBadge.className = 'status-badge';
        safetyBadge.style.backgroundColor = 'var(--color-danger)';
    }

    // Handle Power flow SVG animations
    updateSvgFlowPathAnimations(t);

    // Update real-time charts data arrays
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    // Push new point
    state.history.timestamps.push(timeStr);
    state.history.voltage.push(t.voltage);
    state.history.current.push(t.current);
    state.history.power.push(t.power);
    state.history.mosfet_temp.push(t.mosfet_temperature);
    state.history.battery_temp.push(t.battery_temperature);
    state.history.battery_soh.push(parseFloat(calculatedSoh));

    // Shift oldest point to cap dataset scale size
    if (state.history.timestamps.length > 20) {
        state.history.timestamps.shift();
        state.history.voltage.shift();
        state.history.current.shift();
        state.history.power.shift();
        state.history.mosfet_temp.shift();
        state.history.battery_temp.shift();
        state.history.battery_soh.shift();
    }

    updateCharts();
}

function updateSvgFlowPathAnimations(t) {
    const lineSourceConv = document.getElementById('flow-source-conv');
    const lineConvBatt = document.getElementById('flow-conv-batt');
    const nodeSrc = document.getElementById('node-source');
    const nodeConv = document.getElementById('node-converter');
    const nodeBatt = document.getElementById('node-battery');

    // Clear active classes
    nodeSrc.className.baseVal = 'node-group';
    nodeConv.className.baseVal = 'node-group';
    nodeBatt.className.baseVal = 'node-group';

    if (t.mosfet_status === 'ON') {
        nodeConv.className.baseVal = 'node-group node-active node-active-converter';
        
        if (state.control.mode === 'charge') {
            nodeSrc.className.baseVal = 'node-group node-active node-active-source';
            nodeBatt.className.baseVal = 'node-group node-active node-active-battery';
            
            // Flow: Source -> Converter -> Battery
            lineSourceConv.className.baseVal = 'flow-line flow-active-charging';
            lineConvBatt.className.baseVal = 'flow-line flow-active-charging';
            
            // source line goes forward, batt line goes forward (right to left path reverse direction)
            lineConvBatt.setAttribute('d', 'M 336 100 L 480 100'); // Conv to Batt
        } else if (state.control.mode === 'discharge') {
            nodeSrc.className.baseVal = 'node-group node-active node-active-source';
            nodeBatt.className.baseVal = 'node-group node-active node-active-battery';
            
            // Flow: Battery -> Converter -> Source
            lineSourceConv.className.baseVal = 'flow-line flow-active-discharging';
            lineConvBatt.className.baseVal = 'flow-line flow-active-discharging';
            
            // path directions: Batt to Conv, Conv to Src
            lineConvBatt.setAttribute('d', 'M 480 100 L 336 100'); // Batt to Conv
            lineSourceConv.setAttribute('d', 'M 264 100 L 120 100'); // Conv to Source
        } else if (state.control.mode === 'bidirectional') {
            nodeSrc.className.baseVal = 'node-group node-active node-active-source';
            nodeBatt.className.baseVal = 'node-group node-active node-active-battery';

            // Bidirectional: dynamic coloring
            lineSourceConv.className.baseVal = 'flow-line flow-active-charging';
            lineConvBatt.className.baseVal = 'flow-line flow-active-discharging';
            lineConvBatt.setAttribute('d', 'M 336 100 L 480 100');
        }
    } else {
        // Idle
        lineSourceConv.className.baseVal = 'flow-line flow-inactive';
        lineConvBatt.className.baseVal = 'flow-line flow-inactive';
        lineSourceConv.setAttribute('d', 'M 120 100 L 264 100');
        lineConvBatt.setAttribute('d', 'M 480 100 L 336 100');
    }
}

// Trends indicators calculator
const previousValues = {};
function updateValWithTrend(valId, trendId, currentVal, unit) {
    const valElement = document.getElementById(valId);
    const trendElement = document.getElementById(trendId);
    
    if (!valElement || !trendElement) return;

    valElement.innerHTML = `${currentVal}`;
    
    const prev = previousValues[valId];
    if (prev !== undefined) {
        const diff = currentVal - prev;
        if (diff > 0.01) {
            trendElement.textContent = `▲ +${diff.toFixed(1)}${unit}`;
            trendElement.className = 'kpi-trend up';
        } else if (diff < -0.01) {
            trendElement.textContent = `▼ ${diff.toFixed(1)}${unit}`;
            trendElement.className = 'kpi-trend down';
        } else {
            trendElement.textContent = '● Static';
            trendElement.className = 'kpi-trend neutral';
        }
    }
    
    previousValues[valId] = currentVal;
}

// Link connection banners update
function updateConnectionUI() {
    const statusDot = document.getElementById('sidebar-esp-dot');
    const statusText = document.getElementById('sidebar-esp-text');
    const demoBadge = document.getElementById('sidebar-demo-badge');
    const demoBanner = document.getElementById('demo-banner-alert');
    const connBtn = document.getElementById('btn-esp-connect');

    if (state.connectionStatus === 'connected') {
        statusDot.className = 'status-dot active';
        statusText.textContent = 'ONLINE';
        demoBadge.style.display = 'none';
        demoBanner.style.display = 'none';
        connBtn.textContent = 'Disconnect';
        connBtn.className = 'btn-connect connected';
    } else if (state.connectionStatus === 'connecting') {
        statusDot.className = 'status-dot warning';
        statusText.textContent = 'CONNECTING';
        demoBadge.style.display = 'none';
        demoBanner.style.display = 'flex';
        connBtn.textContent = 'Handshake...';
        connBtn.className = 'btn-connect';
    } else {
        // Demo
        statusDot.className = 'status-dot error';
        statusText.textContent = 'OFFLINE';
        demoBadge.style.display = 'block';
        demoBanner.style.display = 'flex';
        connBtn.textContent = 'Connect';
        connBtn.className = 'btn-connect';
    }
}
