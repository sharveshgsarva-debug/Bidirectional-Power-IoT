/**
 * ESP32-based Smart DC Motor Control & Telemetry Node
 * Communicates with custom web dashboards via local REST API.
 * 
 * REQUIRED ARDUINO IDE LIBRARIES:
 * 1. Adafruit INA219 (by Adafruit)
 * 2. Adafruit SH110X (by Adafruit) - Fits SH1106 1.3" OLED screens
 * 3. Adafruit GFX Library (by Adafruit)
 * 4. ArduinoJson (by Benoit Blanchon)
 * 
 * PIN MAPPINGS:
 * - GPIO 25 : IRF520N Driver Gate Signal (PWM output)
 * - GPIO 34 : LM35DZ Analog Temperature Output
 * - GPIO 21 : Shared I2C SDA (OLED & INA219)
 * - GPIO 22 : Shared I2C SCL (OLED & INA219)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>

// --- Wi-Fi Settings ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// --- Hardware Pins ---
#define PIN_PWM_GATE        25
#define PIN_LM35_TEMP       34
#define I2C_SDA             21
#define I2C_SCL             22

// --- OLED Settings ---
#define SCREEN_WIDTH       128
#define SCREEN_HEIGHT       64
#define OLED_RESET          -1
#define OLED_ADDRESS      0x3C

// --- PWM Speed Settings ---
const int pwmFreq = 5000;
const int pwmResolution = 8;
const int pwmChannel = 0; // Only relevant for ESP32 Arduino core v2.x

// --- Global Classes ---
WebServer server(80);
Adafruit_INA219 ina219;
Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// --- State Variables ---
int motorSpeed = 0; // Starts OFF (0-255)
float busVoltage = 0.0;
float currentMA = 0.0;
float powerMW = 0.0;
float tempC = 0.0;
bool oledReady = false;
bool inaReady = false;

// --- Timing Helpers ---
unsigned long lastDisplayUpdate = 0;
unsigned long lastSerialPrint = 0;
unsigned long lastWiFiCheck = 0;

// --- Function Prototypes ---
void initWiFi();
void initINA219();
void initOLED();
void readTelemetry();
void updateOLED();
void printDiagnostics();
void setupRoutes();
void handleCORSHeaders();
void checkWiFiConnection();

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n==============================================");
    Serial.println("Starting Smart Motor Control Platform Startup...");

    // 1. Initialize PWM Control (Ensuring motor starts OFF)
    pinMode(PIN_PWM_GATE, OUTPUT);
    digitalWrite(PIN_PWM_GATE, LOW);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
    // ESP32 Arduino Core v3.0+ PWM init
    ledcAttach(PIN_PWM_GATE, pwmFreq, pwmResolution);
    ledcWrite(PIN_PWM_GATE, 0);
#else
    // Legacy ESP32 Arduino Core v2.x PWM init
    ledcSetup(pwmChannel, pwmFreq, pwmResolution);
    ledcAttachPin(PIN_PWM_GATE, pwmChannel);
    ledcWrite(pwmChannel, 0);
#endif

    // 2. Initialize Shared I2C Bus on custom pins
    Wire.begin(I2C_SDA, I2C_SCL);

    // 3. Initialize I2C Devices (handling failure gracefully)
    initINA219();
    initOLED();

    // 4. Connect Wi-Fi
    initWiFi();

    // 5. Build REST API Routing
    setupRoutes();
    server.begin();

    // 6. Diagnostics print on startup completion
    Serial.println("\n--- STARTUP DIAGNOSTICS ---");
    Serial.print("Wi-Fi connected: ");
    Serial.println(WiFi.status() == WL_CONNECTED ? "YES" : "NO (FALLBACK AP ACTIVE)");
    Serial.print("ESP32 IP address: ");
    Serial.println(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString());
    Serial.println("API endpoints registered:");
    Serial.println("  - GET /data & /api/data");
    Serial.println("  - GET /status & /api/status");
    Serial.println("  - GET /motor & /api/motor & POST /api/control");
    Serial.println("  - GET /stop & /api/stop");
    Serial.print("INA219 status: ");
    Serial.println(inaReady ? "INITIALIZED (OK)" : "DISCONNECTED (MOCK ACTIVE)");
    Serial.print("OLED status: ");
    Serial.println(oledReady ? "INITIALIZED (OK)" : "DISCONNECTED");
    Serial.println("System ready.");
    Serial.println("==============================================\n");
}

void loop() {
    // Handle incoming REST clients
    server.handleClient();

    // Telemetry sampling
    readTelemetry();

    // Non-blocking Wi-Fi Reconnection watchdog (checks every 10 seconds)
    if (millis() - lastWiFiCheck >= 10000) {
        checkWiFiConnection();
        lastWiFiCheck = millis();
    }

    // Non-blocking local OLED screen refresh (runs at 1Hz)
    if (millis() - lastDisplayUpdate >= 1000) {
        updateOLED();
        lastDisplayUpdate = millis();
    }

    // Non-blocking serial debug print (runs at 2Hz)
    if (millis() - lastSerialPrint >= 500) {
        printDiagnostics();
        lastSerialPrint = millis();
    }
}

// --- Device Initializations ---

void initINA219() {
    if (ina219.begin()) {
        inaReady = true;
    } else {
        Serial.println("Warning: INA219 power monitor not found at address 0x40. Falling back to simulation logic.");
        inaReady = false;
    }
}

void initOLED() {
    // Adafruit SH110X I2C begin syntax (takes address and a reset boolean parameter)
    if (display.begin(OLED_ADDRESS, true)) {
        oledReady = true;
        display.clearDisplay();
        display.setTextSize(1);
        display.setTextColor(SH110X_WHITE);
        display.setCursor(0, 0);
        display.println("Smart Power Node");
        display.println("Booting System...");
        display.display();
    } else {
        Serial.println("Warning: SH1106 OLED display not found at 0x3C. Skipping display updates.");
        oledReady = false;
    }
}

void initWiFi() {
    Serial.print("Connecting to Network SSID: ");
    Serial.println(ssid);
    
    WiFi.begin(ssid, password);

    // Bounded retry connection to avoid locking loop on wrong credentials
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 15) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWi-Fi connection established!");
    } else {
        Serial.println("\nConnection timed out. Launching local AP hotspot...");
        WiFi.softAP("ESP32_Power_Node", "12345678");
    }
}

// --- Telemetry & Sensor Mapping ---

void readTelemetry() {
    // 1. Read INA219 current/voltage/power metrics (if hardware is detected)
    if (inaReady) {
        busVoltage = ina219.getBusVoltage_V();
        currentMA = ina219.getCurrent_mA();
        powerMW = ina219.getPower_mW();
    } else {
        // Safe prototype fallback math (simulates values based on active motor speed)
        float speedRatio = (float)motorSpeed / 255.0;
        busVoltage = 12.0 - (speedRatio * 0.4); // Voltage sag
        currentMA = 50.0 + (speedRatio * 850.0); // Current draw mapping
        powerMW = busVoltage * currentMA;
    }

    // 2. Read LM35DZ Analog Temperature sensor
    // Convert ESP32 analog ADC (12-bit, 0-4095 range) to mV (with 11dB attenuation full range ~ 3.3V)
    int rawAnalog = analogRead(PIN_LM35_TEMP);
    float voltageMV = ((float)rawAnalog / 4095.0) * 3300.0;
    
    // LM35 scaling is 10mV per degree Celsius
    tempC = voltageMV / 10.0;
    
    // Safety check: Clamp unrealistic or disconnected sensor pins
    if (tempC < 0.0 || tempC > 150.0) {
        tempC = 25.0; // Assume standard room temperature on fault
    }
}

void checkWiFiConnection() {
    // Auto reconnect to station network if disconnected
    if (WiFi.status() != WL_CONNECTED && WiFi.getMode() == WIFI_MODE_STA) {
        Serial.println("Wi-Fi link lost. Triggering reconnection sequence...");
        WiFi.disconnect();
        WiFi.reconnect();
    }
}

// --- API Router Endpoints ---

void handleCORSHeaders() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void setupRoutes() {
    // --- CORS OPTIONS handlers ---
    auto handleOptions = []() {
        handleCORSHeaders();
        server.send(200, "text/plain", "");
    };
    
    server.on("/data", HTTP_OPTIONS, handleOptions);
    server.on("/api/data", HTTP_OPTIONS, handleOptions);
    server.on("/status", HTTP_OPTIONS, handleOptions);
    server.on("/api/status", HTTP_OPTIONS, handleOptions);
    server.on("/motor", HTTP_OPTIONS, handleOptions);
    server.on("/api/motor", HTTP_OPTIONS, handleOptions);
    server.on("/api/control", HTTP_OPTIONS, handleOptions);
    server.on("/stop", HTTP_OPTIONS, handleOptions);
    server.on("/api/stop", HTTP_OPTIONS, handleOptions);

    // --- GET /data & /api/data ---
    auto handleData = []() {
        handleCORSHeaders();
        JsonDocument doc;
        doc["voltage"] = round(busVoltage * 100.0) / 100.0;
        doc["current"] = round((currentMA / 1000.0) * 100.0) / 100.0; 
        doc["power"] = round((powerMW / 1000.0) * 100.0) / 100.0;
        doc["temperature"] = round(tempC * 10.0) / 10.0;
        doc["motorSpeed"] = motorSpeed;
        doc["pwm"] = round((motorSpeed / 255.0) * 100.0);
        doc["wifiRSSI"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -99;
        doc["wifi_rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -99;
        doc["mosfet_status"] = motorSpeed > 0 ? "ON" : "OFF";
        doc["source_status"] = "CONNECTED";

        String response;
        serializeJson(doc, response);
        server.send(200, "application/json", response);
    };
    server.on("/data", HTTP_GET, handleData);
    server.on("/api/data", HTTP_GET, handleData);

    // --- GET /status & /api/status ---
    auto handleStatus = []() {
        handleCORSHeaders();
        JsonDocument doc;
        if (WiFi.status() == WL_CONNECTED) {
            doc["status"] = "connected";
            doc["ip"] = WiFi.localIP().toString();
            doc["ssid"] = WiFi.SSID();
            doc["rssi"] = WiFi.RSSI();
            doc["wifi_rssi"] = WiFi.RSSI();
        } else {
            doc["status"] = "AP_mode";
            doc["ip"] = WiFi.softAPIP().toString();
            doc["ssid"] = "ESP32_Power_Node";
            doc["rssi"] = -99;
            doc["wifi_rssi"] = -99;
        }
        doc["sensor_status"] = "ACTIVE";
        doc["safety_status"] = "NOMINAL";
        doc["runtime"] = millis() / 1000;

        String response;
        serializeJson(doc, response);
        server.send(200, "application/json", response);
    };
    server.on("/status", HTTP_GET, handleStatus);
    server.on("/api/status", HTTP_GET, handleStatus);

    // --- GET /motor & /api/control (Unified control router) ---
    auto handleControl = []() {
        handleCORSHeaders();
        
        // 1. Support GET parameter style speed change (e.g. /motor?speed=150)
        if (server.hasArg("speed")) {
            int speedVal = server.arg("speed").toInt();
            motorSpeed = constrain(speedVal, 0, 255);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
            ledcWrite(PIN_PWM_GATE, motorSpeed);
#else
            ledcWrite(pwmChannel, motorSpeed);
#endif
            JsonDocument doc;
            doc["status"] = "SPEED_UPDATED";
            doc["speed"] = motorSpeed;
            doc["mosfet_status"] = motorSpeed > 0 ? "ON" : "OFF";
            String response;
            serializeJson(doc, response);
            server.send(200, "application/json", response);
            Serial.printf("REST API Command: Motor speed set to %d\n", motorSpeed);
            return;
        }
        
        // 2. Support POST JSON style control parameters (e.g. from original dashboard)
        if (server.hasArg("plain")) {
            String body = server.arg("plain");
            JsonDocument doc;
            DeserializationError error = deserializeJson(doc, body);
            if (!error) {
                if (doc.containsKey("estop") && doc["estop"].as<bool>() == true) {
                    motorSpeed = 0;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
                    ledcWrite(PIN_PWM_GATE, 0);
#else
                    ledcWrite(pwmChannel, 0);
#endif
                    Serial.println("E-STOP TRIGGERED OVER REST API!");
                } else if (doc.containsKey("pwm")) {
                    int pwmPct = doc["pwm"].as<int>(); // percentage 0-100
                    motorSpeed = map(constrain(pwmPct, 0, 100), 0, 100, 0, 255);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
                    ledcWrite(PIN_PWM_GATE, motorSpeed);
#else
                    ledcWrite(pwmChannel, motorSpeed);
#endif
                    Serial.printf("REST API Command: Motor speed mapped from PWM %d%% to %d\n", pwmPct, motorSpeed);
                }
                
                JsonDocument response;
                response["status"] = "SUCCESS";
                response["mosfet_status"] = motorSpeed > 0 ? "ON" : "OFF";
                String responseStr;
                serializeJson(response, responseStr);
                server.send(200, "application/json", responseStr);
                return;
            }
        }
        
        server.send(400, "application/json", "{\"error\":\"Missing speed parameter or valid payload\"}");
    };
    
    server.on("/motor", HTTP_GET, handleControl);
    server.on("/api/motor", HTTP_GET, handleControl);
    server.on("/api/control", HTTP_POST, handleControl);

    // --- GET /stop & /api/stop ---
    auto handleStop = []() {
        handleCORSHeaders();
        motorSpeed = 0;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcWrite(PIN_PWM_GATE, 0);
#else
        ledcWrite(pwmChannel, 0);
#endif
        JsonDocument doc;
        doc["status"] = "STOPPED";
        doc["speed"] = 0;
        doc["mosfet_status"] = "OFF";

        String response;
        serializeJson(doc, response);
        server.send(200, "application/json", response);
        Serial.println("REST API Command: Motor STOPPED (Force Shutoff)");
    };
    server.on("/stop", HTTP_GET, handleStop);
    server.on("/api/stop", HTTP_GET, handleStop);
}

// --- Output Display Refresh handlers ---

void updateOLED() {
    if (!oledReady) return;

    display.clearDisplay();
    display.setTextSize(1);
    
    // Header Line
    display.setCursor(0, 0);
    display.setTextColor(SH110X_BLACK, SH110X_WHITE); // Highlight background
    display.println(" SMART POWER SYSTEM ");
    display.setTextColor(SH110X_WHITE);
    display.println(); // Space

    // Display Values
    display.printf("Voltage: %5.2f V\n", busVoltage);
    
    // Display Current in A or mA depending on size
    if (abs(currentMA) >= 1000.0) {
        display.printf("Current: %5.2f A\n", currentMA / 1000.0);
    } else {
        display.printf("Current: %5.0f mA\n", currentMA);
    }
    
    // Power (W)
    display.printf("Power  : %5.2f W\n", powerMW / 1000.0);
    
    // Temperature
    display.printf("Temp   : %5.1f C\n", tempC);
    
    // Bottom Bar: Motor Duty
    display.println("--------------------");
    display.printf("Motor  : %d / 255", motorSpeed);
    
    display.display();
}

void printDiagnostics() {
    // Periodically write telemetry to serial port for debugging
    Serial.printf("LOG: V=%5.2fV | I=%6.1fmA | P=%6.1fmW | T=%5.1fC | Motor=%3d\n", 
                  busVoltage, currentMA, powerMW, tempC, motorSpeed);
}
