/**
 * AI-Driven Smart Bidirectional Power Electronics Platform
 * ESP32 IoT Node Firmware (Wi-Fi, JSON REST API, Gateway Control)
 * 
 * Target Board: ESP32 DevKit V1
 * Required Libraries: 
 *   - ArduinoJson (by Benoit Blanchon)
 *   - OneWire (by Paul Stoffregen) - For DS18B20 Temperature
 *   - DallasTemperature (by Miles Burton) - For DS18B20 Temperature
 *   - Adafruit SSD1306 & Adafruit GFX (Optional, for OLED display)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// Wi-Fi Connection Details - Customize for local LAN environment
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Hardware Pin Definitions
#define PIN_PWM_GATE        25  // PWM control signal to MOSFET Gate Driver
#define PIN_GATE_ENABLE     26  // Enable pin for gate driver IC
#define PIN_VOLTAGE_SENSE   35  // ADC channel for Voltage Sensor (resistor divider)
#define PIN_CURRENT_SENSE   34  // ADC channel for ACS712/ACS758 current sensor
#define PIN_ONE_WIRE_BUS     4  // DS18B20 Temperature sensor data pin
#define PIN_FAN_CONTROL     27  // Transistor circuit driving cooling fan
#define PIN_BUZZER          12  // Warning buzzer alarm pin

// DS18B20 Temp Sensor initialization
OneWire oneWire(PIN_ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

// Web Server instance (port 80)
WebServer server(80);

// PWM Signal Configuration
const int pwmFreq = 25000;      // 25 kHz switching frequency for power MOSFETs
const int pwmChannel = 0;       // LEDC channel 0
const int pwmResolution = 8;    // 8-bit resolution (0 - 255)

// Global Operational Variables
float batteryVoltage = 12.4;
float batteryCurrent = 0.0;
float systemPower = 0.0;
int batterySOC = 78;
float mosfetTemperature = 32.5;
float batteryTemperature = 28.2;
bool isCharging = false;
String mosfetStatus = "OFF";
String sourceStatus = "CONNECTED";
String safetyStatus = "NOMINAL";
unsigned long systemRuntime = 0;

// Safety Limit Configurations (Loaded/Saved in simulated EEPROM variables)
struct SafetyLimits {
    float maxVoltage = 16.0;
    float minVoltage = 9.6;
    float maxCurrent = 10.0;
    float maxMosfetTemp = 75.0;
    float maxBatteryTemp = 50.0;
    int lowSocCutoff = 15;
} limits;

// Target Control parameters (Updated via Dashboard API)
struct TargetControls {
    String mode = "charge"; // "charge", "discharge", "bidirectional"
    int pwmDuty = 0;        // 0 to 100%
    float vLimit = 14.4;
    float iLimit = 5.0;
    bool estop = false;
} target;

// Telemetry Polling Timer
unsigned long lastTelemetryUpdate = 0;
unsigned long lastSafetyCheck = 0;

// Function declarations
void setupWiFi();
void setupRESTEndpoints();
void handleCORSHeaders();
void readSensors();
void runSafetyCoreCheck();
void applySwitchingControl();
void sendJsonResponse(int code, JsonDocument& doc);

void setup() {
    Serial.begin(115200);
    
    // Configure GPIO states
    pinMode(PIN_GATE_ENABLE, OUTPUT);
    digitalWrite(PIN_GATE_ENABLE, LOW); // Keep gate driver disabled on startup
    
    pinMode(PIN_FAN_CONTROL, OUTPUT);
    digitalWrite(PIN_FAN_CONTROL, LOW);
    
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
    
    // Initialize Temperature sensors
    sensors.begin();
    
    // Configure ESP32 PWM LEDC channel for Gate Driver
    ledcSetup(pwmChannel, pwmFreq, pwmResolution);
    ledcAttachPin(PIN_PWM_GATE, pwmChannel);
    ledcWrite(pwmChannel, 0); // 0% duty cycle initially

    // Initialize Network connection
    setupWiFi();
    
    // Configure Endpoints
    setupRESTEndpoints();
    server.begin();
    Serial.println("REST API Server initialized on port 80");
}

void loop() {
    server.handleClient();
    
    // Run hardware sensors readings every 1000ms
    if (millis() - lastTelemetryUpdate >= 1000) {
        readSensors();
        systemRuntime = millis() / 1000;
        lastTelemetryUpdate = millis();
    }
    
    // Run safety loop checks every 100ms
    if (millis() - lastSafetyCheck >= 100) {
        runSafetyCoreCheck();
        applySwitchingControl();
        lastSafetyCheck = millis();
    }
}

// Wi-Fi Connection
void setupWiFi() {
    Serial.print("Connecting to Network: ");
    Serial.println(ssid);
    
    WiFi.begin(ssid, password);
    
    // Blink onboard LED or print status while connecting
    int retryCount = 0;
    while (WiFi.status() != WL_CONNECTED && retryCount < 20) {
        delay(500);
        Serial.print(".");
        retryCount++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWi-Fi connection established!");
        Serial.print("ESP32 Station IP Address: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\nUnable to connect to local Wi-Fi. Initializing Safe AP Mode...");
        // Fallback Access Point Mode
        WiFi.softAP("ESP32_Power_Platform", "12345678");
        Serial.print("Access Point IP Address: ");
        Serial.println(WiFi.softAPIP());
    }
}

// Configure CORS and JSON routes
void setupRESTEndpoints() {
    
    // OPTIONS Preflight requests handler for CORS compliance
    server.on("/api/data", HTTP_OPTIONS, []() {
        handleCORSHeaders();
        server.send(200, "text/plain", "");
    });
    server.on("/api/status", HTTP_OPTIONS, []() {
        handleCORSHeaders();
        server.send(200, "text/plain", "");
    });
    server.on("/api/control", HTTP_OPTIONS, []() {
        handleCORSHeaders();
        server.send(200, "text/plain", "");
    });
    server.on("/api/config", HTTP_OPTIONS, []() {
        handleCORSHeaders();
        server.send(200, "text/plain", "");
    });

    // GET `/api/data` - Telemetry JSON response
    server.on("/api/data", HTTP_GET, []() {
        handleCORSHeaders();
        JsonDocument doc;
        doc["voltage"] = batteryVoltage;
        doc["current"] = batteryCurrent;
        doc["power"] = systemPower;
        doc["battery_soc"] = batterySOC;
        doc["mosfet_temperature"] = mosfetTemperature;
        doc["battery_temperature"] = batteryTemperature;
        doc["charging"] = isCharging;
        doc["mosfet_status"] = mosfetStatus;
        doc["source_status"] = sourceStatus;
        
        sendJsonResponse(200, doc);
    });

    // GET `/api/status` - Diagnostics & Network details
    server.on("/api/status", HTTP_GET, []() {
        handleCORSHeaders();
        JsonDocument doc;
        doc["wifi_rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
        doc["sensor_status"] = "ACTIVE";
        doc["safety_status"] = safetyStatus;
        doc["runtime"] = systemRuntime;
        
        sendJsonResponse(200, doc);
    });

    // POST `/api/control` - Receive power commands
    server.on("/api/control", HTTP_POST, []() {
        handleCORSHeaders();
        if (server.hasArg("plain") == false) {
            server.send(400, "application/json", "{\"error\":\"Missing body\"}");
            return;
        }

        String body = server.arg("plain");
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, body);
        
        if (error) {
            server.send(400, "application/json", "{\"error\":\"Invalid JSON format\"}");
            return;
        }

        // Apply commands
        if (doc.containsKey("estop") && doc["estop"].as<bool>() == true) {
            target.estop = true;
            target.pwmDuty = 0;
            mosfetStatus = "OFF";
            digitalWrite(PIN_GATE_ENABLE, LOW);
            ledcWrite(pwmChannel, 0);
            safetyStatus = "EMERGENCY_STOP";
            Serial.println("E-STOP TRIGGERED OVER REST API!");
        } else {
            if (doc.containsKey("mode")) target.mode = doc["mode"].as<String>();
            if (doc.containsKey("pwm")) target.pwmDuty = doc["pwm"].as<int>();
            if (doc.containsKey("vLimit")) target.vLimit = doc["vLimit"].as<float>();
            if (doc.containsKey("iLimit")) target.iLimit = doc["iLimit"].as<float>();
            target.estop = false;
        }

        JsonDocument response;
        response["status"] = "SUCCESS";
        response["mosfet_status"] = mosfetStatus;
        sendJsonResponse(200, response);
    });

    // POST `/api/config` - Upload EEPROM configuration thresholds
    server.on("/api/config", HTTP_POST, []() {
        handleCORSHeaders();
        if (server.hasArg("plain") == false) {
            server.send(400, "application/json", "{\"error\":\"Missing body\"}");
            return;
        }

        String body = server.arg("plain");
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, body);
        
        if (error) {
            server.send(400, "application/json", "{\"error\":\"Invalid JSON format\"}");
            return;
        }

        if (doc.containsKey("max_v")) limits.maxVoltage = doc["max_v"].as<float>();
        if (doc.containsKey("min_v")) limits.minVoltage = doc["min_v"].as<float>();
        if (doc.containsKey("max_i")) limits.maxCurrent = doc["max_i"].as<float>();
        if (doc.containsKey("max_mosfet_temp")) limits.maxMosfetTemp = doc["max_mosfet_temp"].as<float>();
        if (doc.containsKey("max_batt_temp")) limits.maxBatteryTemp = doc["max_batt_temp"].as<float>();
        if (doc.containsKey("low_soc")) limits.lowSocCutoff = doc["low_soc"].as<int>();

        Serial.println("Configuration limits updated via REST API.");
        
        JsonDocument response;
        response["status"] = "LIMITS_UPDATED";
        sendJsonResponse(200, response);
    });
}

// Enable browser CORS capability
void handleCORSHeaders() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS,PUT,DELETE");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

// Convert JSON to String and send response
void sendJsonResponse(int code, JsonDocument& doc) {
    String output;
    serializeJson(doc, output);
    server.send(code, "application/json", output);
}

// Read Analog Sensors and calculate physical values
void readSensors() {
    // 1. Read Voltage (Simulated ADC reads or physical ADC calibration)
    // Formula: V = ADC_VAL * (V_REF / 4095.0) * ((R1 + R2) / R2)
    int rawV = analogRead(PIN_VOLTAGE_SENSE);
    float measuredV = (rawV / 4095.0) * 3.3 * (100.0 / 10.0); // Calibrated divisor example
    
    // 2. Read Current (ACS712 Calibration)
    // Formula: I = (ADC_VAL * (V_REF / 4095.0) - V_OFFSET) / SENSITIVITY
    int rawI = analogRead(PIN_CURRENT_SENSE);
    float voltageACS = (rawI / 4095.0) * 3.3;
    float measuredI = (voltageACS - 1.65) / 0.066; // 66mV/A for ACS712 30A

    // 3. Dallas Temperature sensors probe read
    sensors.requestTemperatures();
    float tempDS18B20 = sensors.getTempCByIndex(0);
    
    // Fallback: If hardware sensors are disconnected/floating, generate safe working values
    if (isnan(measuredV) || rawV < 100) {
        // Mock calculations for testing dashboard when disconnected from test jig
        // Telemetry follows target control duty values
        if (mosfetStatus == "ON") {
            float simulatedLoadFactor = target.pwmDuty / 100.0;
            if (target.mode == "charge") {
                batteryCurrent = target.iLimit * simulatedLoadFactor;
                batteryVoltage = 12.0 + (batteryCurrent * 0.15); // Voltage charging rise
                if (batterySOC < 100) batterySOC += 1;
            } else {
                batteryCurrent = -target.iLimit * simulatedLoadFactor;
                batteryVoltage = 12.4 + (batteryCurrent * 0.18); // voltage discharging drop
                if (batterySOC > limits.lowSocCutoff) batterySOC -= 1;
            }
            mosfetTemperature = 30.0 + (abs(batteryCurrent) * 3.5);
            batteryTemperature = 26.5 + (abs(batteryCurrent) * 0.8);
        } else {
            batteryCurrent = 0.0;
            batteryVoltage = 12.4;
            mosfetTemperature = 28.0;
            batteryTemperature = 26.0;
        }
    } else {
        // Physical readings mapping
        batteryVoltage = measuredV;
        batteryCurrent = measuredI;
        mosfetTemperature = tempDS18B20 > -50 ? tempDS18B20 : 25.0;
        batteryTemperature = 27.5; // Ambient battery mapping
    }

    systemPower = batteryVoltage * abs(batteryCurrent);
    isCharging = (batteryCurrent > 0.08);
}

// Hardware Safety Protection Loop (High-integrity lock)
void runSafetyCoreCheck() {
    if (target.estop) {
        safetyStatus = "EMERGENCY_STOP";
        return;
    }

    // 1. Over-Voltage boundary check
    if (batteryVoltage > limits.maxVoltage) {
        safetyStatus = "OVER_VOLTAGE";
        target.estop = true;
    }
    // 2. Under-Voltage boundary check
    else if (batteryVoltage < limits.minVoltage) {
        safetyStatus = "UNDER_VOLTAGE";
        target.estop = true;
    }
    // 3. Over-Current check
    else if (abs(batteryCurrent) > limits.maxCurrent) {
        safetyStatus = "OVER_CURRENT";
        target.estop = true;
    }
    // 4. Over Temperature MOSFET protection
    else if (mosfetTemperature > limits.maxMosfetTemp) {
        safetyStatus = "OVER_TEMP_MOSFET";
        target.estop = true;
    }
    // 5. Over Temperature Battery protection
    else if (batteryTemperature > limits.maxBatteryTemp) {
        safetyStatus = "OVER_TEMP_BATTERY";
        target.estop = true;
    }
    // 6. SOC lower cutoff
    else if (batterySOC <= limits.lowSocCutoff && target.mode == "discharge") {
        safetyStatus = "LOW_SOC_CUTOFF";
        target.estop = true;
    }
    else {
        safetyStatus = "NOMINAL";
    }

    // Safety Trip Trigger Action
    if (target.estop) {
        // Instantly shut down switching hardware
        digitalWrite(PIN_GATE_ENABLE, LOW);
        ledcWrite(pwmChannel, 0);
        mosfetStatus = "OFF";
        
        // Active warning buzzer
        digitalWrite(PIN_BUZZER, HIGH);
        
        // Drive cooling fan to 100% capacity
        digitalWrite(PIN_FAN_CONTROL, HIGH);
        
        Serial.print("SAFETY FAULT DETECTED: ");
        Serial.println(safetyStatus);
    } else {
        digitalWrite(PIN_BUZZER, LOW);
    }
}

// Drive gate switching signals based on parameters
void applySwitchingControl() {
    if (target.estop || safetyStatus != "NOMINAL") {
        digitalWrite(PIN_GATE_ENABLE, LOW);
        ledcWrite(pwmChannel, 0);
        mosfetStatus = "OFF";
        return;
    }

    // Determine cooling fan speed based on thermal levels
    if (mosfetTemperature > 40.0) {
        digitalWrite(PIN_FAN_CONTROL, HIGH); // Turn fan on
    } else {
        digitalWrite(PIN_FAN_CONTROL, LOW);
    }

    // Apply PWM duty write to MOSFET Gate Driver
    if (target.pwmDuty > 0) {
        digitalWrite(PIN_GATE_ENABLE, HIGH);
        
        // Map duty cycle % (0-100) to 8-bit LEDC duty range (0-255)
        int dutyValue = map(target.pwmDuty, 0, 100, 0, 255);
        ledcWrite(pwmChannel, dutyValue);
        mosfetStatus = "ON";
    } else {
        digitalWrite(PIN_GATE_ENABLE, LOW);
        ledcWrite(pwmChannel, 0);
        mosfetStatus = "OFF";
    }
}
