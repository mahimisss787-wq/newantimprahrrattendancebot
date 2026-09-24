import os
import csv
import json
from datetime import datetime
import pytz

MONGODB_URI = os.getenv("MONGODB_URI", "")
mongo_client = None
db = None

if MONGODB_URI and MONGODB_URI.strip():
    try:
        from pymongo import MongoClient
        mongo_client = MongoClient(MONGODB_URI.strip(), serverSelectionTimeoutMS=5000)
        db = mongo_client.get_database("attendance_bot")
        print("✅ [PYTHON DATABASE] Connected to MongoDB Atlas Cloud successfully!")
    except Exception as e:
        print(f"❌ [PYTHON DATABASE ERROR] MongoDB Connection Failed: {e}")

members_col = db["members"] if db is not None else None
attendance_col = db["attendances"] if db is not None else None

LOCAL_DB_FILE = os.path.join(os.path.dirname(__file__), "attendance_db.json")

def load_local_db():
    if not os.path.exists(LOCAL_DB_FILE):
        return {"members": {}, "attendance": []}
    try:
        with open(LOCAL_DB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"members": {}, "attendance": []}

def save_local_db(data):
    try:
        with open(LOCAL_DB_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Local DB Save Error: {e}")

def register_member(user_id, name, username):
    if not user_id:
        return
    u_id_str = str(user_id)
    ist = pytz.timezone("Asia/Kolkata")

    local_data = load_local_db()
    local_data["members"][u_id_str] = {
        "userId": u_id_str,
        "name": name or "Unknown",
        "username": username or "",
        "lastSeen": datetime.now(ist).isoformat()
    }
    save_local_db(local_data)

    if members_col is not None:
        try:
            members_col.update_one(
                {"userId": u_id_str},
                {"$set": {
                    "userId": u_id_str,
                    "name": name or "Unknown",
                    "username": username or "",
                    "lastSeen": datetime.now(ist).isoformat()
                }},
                upsert=True
            )
        except Exception as e:
            print(f"Mongo Register Error: {e}")

def add_attendance(record):
    if not record.get("userId"):
        return False
    u_id_str = str(record["userId"])
    date_str = str(record["date"]).strip()
    ist = pytz.timezone("Asia/Kolkata")
    now_ist = datetime.now(ist).strftime("%d-%m-%Y %I:%M:%S %p")

    if attendance_col is not None:
        try:
            existing = attendance_col.find_one({"userId": u_id_str, "date": date_str})
            if existing:
                return False
            attendance_col.insert_one({
                "date": date_str,
                "userId": u_id_str,
                "name": record.get("name", "Unknown"),
                "username": record.get("username", ""),
                "status": record.get("status", "Present"),
                "reason": record.get("reason", ""),
                "timestamp": now_ist
            })
            return True
        except Exception as e:
            print(f"Mongo Attendance Error: {e}")

    local_data = load_local_db()
    exists = any(str(a.get("userId")) == u_id_str and str(a.get("date")).strip() == date_str for a in local_data["attendance"])
    if exists:
        return False

    local_data["attendance"].append({
        "date": date_str,
        "userId": u_id_str,
        "name": record.get("name", "Unknown"),
        "username": record.get("username", ""),
        "status": record.get("status", "Present"),
        "reason": record.get("reason", ""),
        "timestamp": now_ist
    })
    save_local_db(local_data)
    return True

def get_all_attendance():
    if attendance_col is not None:
        try:
            docs = list(attendance_col.find({}, {"_id": 0}))
            if docs:
                return docs
        except Exception as e:
            print(f"Mongo Get Attendance Error: {e}")
    local_data = load_local_db()
    return local_data.get("attendance", [])

def get_all_members():
    if members_col is not None:
        try:
            docs = list(members_col.find({}, {"_id": 0}))
            if docs:
                return docs
        except Exception as e:
            print(f"Mongo Get Members Error: {e}")
    local_data = load_local_db()
    return list(local_data.get("members", {}).values())

def generate_csv_filepath():
    records = get_all_attendance()
    filepath = os.path.join(os.path.dirname(__file__), "attendance_report.csv")
    headers = ["Date", "User ID", "Name", "Username", "Status", "Reason", "Time (IST)"]

    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        for r in records:
            writer.writerow([
                r.get("date", ""),
                r.get("userId", ""),
                r.get("name", ""),
                r.get("username", ""),
                r.get("status", ""),
                r.get("reason", ""),
                r.get("timestamp", "")
            ])
    return filepath
