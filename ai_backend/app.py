from flask import Flask, request, jsonify
import math

app = Flask(__name__)

# Add simple CORS support directly to endpoints (avoid external dependencies issues)
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS,PUT,DELETE'
    return response

# Handle preflight OPTIONS requests automatically
@app.route('/api/analyze', methods=['OPTIONS'])
def options_handler():
    return jsonify({"status": "CORS_PREFLIGHT_OK"}), 200

@app.route('/api/analyze', methods=['POST'])
def analyze_telemetry():
    """
    Predictive maintenance diagnostic model for Smart Bidirectional Converters.
    Processes incoming sensor logs and outputs fault predictions and suggestions.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Telemetry JSON body missing"}), 400

    # Extract parameters
    voltage = data.get("voltage", 12.4)
    current = data.get("current", 0.0)
    power = data.get("power", 0.0)
    battery_soc = data.get("battery_soc", 78)
    mosfet_temp = data.get("mosfet_temperature", 32.5)
    battery_temp = data.get("battery_temperature", 28.2)
    charging = data.get("charging", False)
    mosfet_status = data.get("mosfet_status", "OFF")
    source_status = data.get("source_status", "CONNECTED")
    safety_status = data.get("safety_status", "NOMINAL")
    runtime = data.get("runtime", 0)
    health_pct = data.get("health_pct", 98.0)
    impedance = data.get("impedance_mohm", 42)
    cycles = data.get("cycles", 100)

    # Initial condition states
    system_condition = "HEALTHY"
    voltage_evaluation = "Normal"
    current_evaluation = "Normal"
    mosfet_evaluation = "Normal"
    battery_evaluation = "Normal"
    risk_level = "LOW"
    anomaly_score = 1.0
    recommendations = []

    # Rule 1: High MOSFET temperature check (Thermal stress diagnosis)
    if mosfet_temp > 70.0:
        system_condition = "CRITICAL"
        mosfet_evaluation = "MOSFET Thermal Critical"
        risk_level = "HIGH"
        anomaly_score = 88.5
        recommendations.append("CRITICAL: MOSFET temp is in thermal runaway bounds. Switching gates shut down. Verify thermal pad contacts and fan wiring.")
    elif mosfet_temp > 58.0:
        system_condition = "WARNING"
        mosfet_evaluation = "MOSFET Elevated Temp"
        risk_level = "MEDIUM"
        anomaly_score = 42.0
        recommendations.append("WARNING: MOSFET temperature is elevated. Inspect thermal interface paste degradation and cooling fan intake vents.")

    # Rule 2: Low state of charge or depth of discharge issues
    if battery_soc < 15:
        system_condition = "CRITICAL" if system_condition == "CRITICAL" else "WARNING"
        battery_evaluation = "Battery Voltage Low"
        risk_level = "HIGH" if risk_level == "HIGH" else "MEDIUM"
        anomaly_score = max(anomaly_score, 65.0)
        recommendations.append("ALERT: State of Charge is below cutoff range. System switching to CHARGING mode required to prevent cell damage.")
    
    # Rule 3: Ageing characteristics (SOH vs Internal Impedance)
    if impedance > 80:
        battery_evaluation = "High Impedance Degradation"
        system_condition = "WARNING" if system_condition == "HEALTHY" else system_condition
        risk_level = "MEDIUM" if risk_level == "LOW" else risk_level
        anomaly_score = max(anomaly_score, 30.5)
        recommendations.append("MAINTENANCE: Estimated cell internal impedance exceeds 80 mΩ. Cycle life capacity degradation active. Plan battery reconditioning.")

    # Rule 4: Switching gate logic safety fault
    if mosfet_status == "OFF" and abs(current) > 0.8:
        system_condition = "CRITICAL"
        current_evaluation = "Switching Leakage Fault"
        risk_level = "HIGH"
        anomaly_score = 94.2
        recommendations.append("CRITICAL FAULT: MOSFET gates reporting OFF status, but significant current flow (>0.8A) sensed. Gate-driver short circuit suspected!")

    # Compile final recommendation string
    if not recommendations:
        final_recom = "All telemetry streams are nominal. Core safety bounds verify healthy. No maintenance required."
    else:
        final_recom = " | ".join(recommendations)

    # Format output JSON
    response_payload = {
        "system_condition": system_condition,
        "voltage_evaluation": voltage_evaluation if safety_status == "NOMINAL" else f"Fault: {safety_status}",
        "current_evaluation": current_evaluation,
        "mosfet_evaluation": mosfet_evaluation,
        "battery_evaluation": battery_evaluation,
        "anomaly_score": f"{anomaly_score:.1f}%",
        "risk_level": risk_level,
        "recommendation": final_recom
    }

    return jsonify(response_payload), 200

if __name__ == '__main__':
    print("AI Diagnostic Backend server starting on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
