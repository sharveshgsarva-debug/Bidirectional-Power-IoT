# AI-Driven Smart Bidirectional Power Electronics Platform - Dashboard & Firmware

This repository contains the complete dashboard, ESP32 firmware, and predictive AI server code for the **AI-Driven Smart Bidirectional Power Electronics Platform**.

The platform is designed to control DC power-flow bidirectionally between a DC Source (e.g. Solar panel power supply) and a Battery Pack using Power MOSFET switching.

---

## 🛠️ Project Structure
```
Bidirectional-Power-IoT/
├── index.html                   # Core dashboard web interface (5 panels)
├── styles.css                   # Glassmorphism dark industrial styles
├── app.js                       # Frontend UI updating, charting, and polling control
├── esp32_firmware/
│   └── esp32_firmware.ino       # ESP32 C++ firmware (Bidirectional Battery/Source Switching)
├── esp32_firmware_motor/
│   └── esp32_firmware_motor.ino # ESP32 C++ firmware (DC Motor, INA219, LM35DZ, SH1106 1.3" OLED)
└── ai_backend/
    └── app.py                   # Python Flask server (Predictive maintenance analytics engine)
```

---

## 🔌 Hardware Wiring Configuration

The system is **DC power only**. Make sure to deploy appropriate heat sinks, cooling fans, and fuses before running high-current loads.

| Hardware Module | ESP32 GPIO Pin | Connection Notes |
| :--- | :--- | :--- |
| **MOSFET PWM Switching** | `GPIO 25` | Output to Gate Driver Input pin |
| **Gate Driver Enable** | `GPIO 26` | Enable/Disable switching gate signals |
| **Voltage Sensor** | `GPIO 35` | Analogue ADC Input (resistor divider network) |
| **Current Sensor** | `GPIO 34` | ACS712 / ACS758 current probe output (analogue input) |
| **DS18B20 Temp Sensor** | `GPIO 4` | Dallas OneWire bus data (needs 4.7kΩ pull-up resistor) |
| **Cooling Fan Switch** | `GPIO 27` | Triggers N-MOSFET gate driving fan relay/fan transistor |
| **Warning Buzzer** | `GPIO 12` | Triggers alarms on safety limit trips |

---

## 💻 Software Setup & Run Instructions

### 1. Running the Web Dashboard (Demo Mode / Live Mode)
The dashboard runs completely locally.
1. Open the [index.html](index.html) file in any modern web browser.
2. By default, since the dashboard does not detect an ESP32 hardware node, it enters **DEMO MODE**. The simulation engine generates realistic fluctuating telemetry data (Voltage, Current, Temps, SOC, Fan status).
3. Switch tabs on the sidebar to explore:
   - **Overview**: Real-time statistcal graphs and health indicators.
   - **Power Control**: Interactive switching controls (requires unlocking the safety interlock checkbox first).
   - **Battery**: Pack State of Health and charge monitoring.
   - **AI Analysis**: Neural prediction output logs.
   - **IoT & Settings**: Advanced IP connection settings and safety threshold updates.

### 2. Setting up the ESP32 Firmware
1. Open the Arduino IDE (or VS Code PlatformIO).
2. Install the following libraries using the **Library Manager**:
   - `ArduinoJson` (v6 or v7)
   - `DallasTemperature`
   - `OneWire`
3. Open [esp32_firmware.ino](esp32_firmware/esp32_firmware.ino).
4. Update the Wi-Fi credentials variables:
   ```cpp
   const char* ssid = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```
5. Select **ESP32 Dev Module** as the target board, connect the ESP32 via USB, and hit **Upload**.
6. Once uploaded, open the **Serial Monitor** set to `115200` baud.
7. The ESP32 will print its connection status. If it connects to Wi-Fi successfully, it prints:
   `ESP32 Station IP Address: 192.168.1.50`
   *(If your LAN is not found, the ESP32 launches its own AP Access Point called `ESP32_Power_Platform` with IP `192.168.4.1`)*.

### 3. Connecting the Dashboard to ESP32
1. Note the IP address printed in the Serial Monitor (e.g. `http://192.168.1.50`).
2. Go to the dashboard header, enter the IP URL in the text input box, and click **Connect**.
3. The dashboard status indicator changes to **ONLINE**, the orange demo banner disappears, and real hardware telemetry streams directly into the charts.

### 4. Running the AI Diagnostic Backend
The AI analysis page communicates with a local microservice for anomaly classification.
1. Make sure Python 3 is installed.
2. Install Flask:
   ```bash
   pip install flask
   ```
3. Run the AI backend server:
   ```bash
   python ai_backend/app.py
   ```
4. The server launches on port 5000: `http://localhost:5000`.
5. On the dashboard's **IoT & Settings** tab, ensure the **AI Diagnostic Backend URL** is set to `http://localhost:5000` and click **Save Settings**.
6. The sidebar's AI Core indicator lights up **ONLINE**, and complex anomalies will be processed and logged.

---

## 🔒 Safety Interlocks & Protection Routine
The system includes built-in hardware protection logic inside the ESP32 `loop()` running at `10Hz` (every 100ms):
* **Over-Voltage Trip**: Shuts down switching if battery voltage exceeds limit (Default: 16.0V).
* **Under-Voltage Trip**: Shuts down switching if battery drops below safe level (Default: 9.6V).
* **Over-Current Trip**: Automatically disables gates if current exceeds boundary (Default: 10.0A).
* **Thermal Runaway Trip**: MOSFET temperature exceeding threshold triggers a shutdown (Default: 75°C) and drives the cooling fan to 100%.

If any safety trip occurs, the ESP32 will sound a buzzer, shut off the MOSFET gates instantly, and transmit the diagnostic error code (e.g. `OVER_TEMP_MOSFET`) to the REST API, displaying a bright hazard alarm on the dashboard UI.
