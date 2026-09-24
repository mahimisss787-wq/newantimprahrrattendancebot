import os
import html
import asyncio
from datetime import datetime, time, timedelta
import pytz
from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes
import db

BOT_TOKEN = os.getenv("BOT_TOKEN", "8974478810:AAEgxD-ikJrMwV_JSBJY9F45ppBhefoZjtg")
GROUP_CHAT_ID = os.getenv("GROUP_CHAT_ID", "-1003493006883")
START_HOUR = int(os.getenv("ATTENDANCE_START_HOUR", "6"))
END_HOUR = int(os.getenv("ATTENDANCE_END_HOUR", "10"))

ist = pytz.timezone("Asia/Kolkata")

async def track_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user:
        db.register_member(
            update.effective_user.id,
            update.effective_user.first_name,
            update.effective_user.username
        )

async def morning_announcement(context: ContextTypes.DEFAULT_TYPE):
    try:
        msg = ("🌸 राधे राधे! आप सभी का स्वागत है। ☀️\n\n"
               "💚 Daily Attendance is now OPEN.\n\n"
               "⏰ Timing:\n"
               "🕕 06:00 AM – 10:00 AM (IST)\n\n"
               "📌 Mark your attendance by sending:\n"
               "👉🏻 /present\n\n"
               "📚 📚 Keep learning. Keep growing.\n"
               "✨ Have a wonderful day! 😍")
        await context.bot.send_message(chat_id=GROUP_CHAT_ID, text=msg)
    except Exception as e:
        print(f"[CRON 6 AM ERROR]: {e}")

async def night_report(context: ContextTypes.DEFAULT_TYPE):
    try:
        members = db.get_all_members()
        attendance = db.get_all_attendance()

        now_ist = datetime.now(ist)
        today = now_ist.strftime("%d-%m-%Y")
        yesterday = (now_ist - timedelta(days=1)).strftime("%d-%m-%Y")
        day_before = (now_ist - timedelta(days=2)).strftime("%d-%m-%Y")

        today_attendance = [r for r in attendance if str(r.get("date", "")).strip() == today]
        present_users = [r for r in today_attendance if str(r.get("status", "Present")).strip() == "Present"]
        leave_users = [r for r in today_attendance if str(r.get("status", "")).strip() == "Leave"]

        present_user_ids = {str(u.get("userId")) for u in present_users}
        leave_user_ids = {str(u.get("userId")) for u in leave_users}

        absent_users = [m for m in members if str(m.get("userId")) not in present_user_ids and str(m.get("userId")) not in leave_user_ids]

        warnings = []
        for m in absent_users:
            m_id = str(m.get("userId"))
            attended_yesterday = any(str(r.get("date", "")).strip() == yesterday and str(r.get("userId")) == m_id for r in attendance)
            attended_day_before = any(str(r.get("date", "")).strip() == day_before and str(r.get("userId")) == m_id for r in attendance)
            if not attended_yesterday and not attended_day_before:
                warnings.append(m.get("name", "Unknown"))

        divider = "━━━━━━━━━━━━━━━━━━━━━━\n"
        msg = f"<b>📊 DAILY ATTENDANCE REPORT</b>\n{divider}📅 <b>Date:</b> <code>{today}</code>\n👥 <b>Total Members:</b> <code>{len(members)}</code>\n{divider}✅ <b>Present Count:</b> <code>{len(present_users)}</code>\n\n"
        
        if present_users:
            msg += "📝 <b>Present Members:</b>\n" + "".join([f"  <b>{i+1}.</b> <code>{html.escape(u.get('name','Unknown'))}</code>\n" for i, u in enumerate(present_users)])
        else:
            msg += "📝 <b>Present Members:</b>\n  <i>None</i>"

        await context.bot.send_message(chat_id=GROUP_CHAT_ID, text=msg, parse_mode="HTML")

        # Leave msg
        leave_msg = f"🍂 <b>ON LEAVE COUNT: {len(leave_users)}</b>\n{divider}"
        if leave_users:
            leave_msg += "📝 <b>Leave Registered:</b>\n" + "".join([f"  <b>{i+1}.</b> <code>{html.escape(u.get('name','Unknown'))}</code>\n     ┗ <i>{html.escape(u.get('reason','No reason'))}</i>\n" for i, u in enumerate(leave_users)])
        else:
            leave_msg += "📝 <b>Leave Registered:</b>\n  <i>None</i>"
        await context.bot.send_message(chat_id=GROUP_CHAT_ID, text=leave_msg, parse_mode="HTML")

        # Absent msg
        absent_msg = f"❌ <b>ABSENT COUNT: {len(absent_users)}</b>\n{divider}"
        if absent_users:
            absent_msg += "📝 <b>Absent Members:</b>\n" + "".join([f"  <b>{i+1}.</b> <code>{html.escape(u.get('name','Unknown'))}</code>\n" for i, u in enumerate(absent_users)])
        else:
            absent_msg += "📝 <b>Absent Members:</b>\n  <i>None</i>"
        
        absent_msg += "\n⚠️ <b>Consecutive Absentees (3+ days):</b>\n"
        if warnings:
            absent_msg += "".join([f"  <b>{i+1}.</b> <code>{html.escape(w)}</code> ⚠️\n" for i, w in enumerate(warnings)])
        else:
            absent_msg += "  <i>None</i>"

        await context.bot.send_message(chat_id=GROUP_CHAT_ID, text=absent_msg, parse_mode="HTML")

        # Send CSV file
        csv_path = db.generate_csv_filepath()
        with open(csv_path, "rb") as doc:
            await context.bot.send_document(chat_id=GROUP_CHAT_ID, document=doc, filename=f"attendance_{today}.csv", caption=f"📁 Daily Attendance Excel/CSV Export ({today})")

    except Exception as e:
        print(f"[CRON 9 PM ERROR]: {e}")

async def present_or_leave(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type == "private":
        return

    user = update.effective_user
    user_id = str(user.id)
    name = user.first_name or "Unknown"
    username = user.username or ""

    text = update.message.text.strip()
    is_present = text.lower().startswith("/present")
    status = "Present" if is_present else "Leave"
    reason = " ".join(text.split()[1:]) if not is_present and len(text.split()) > 1 else ("No reason specified" if not is_present else "")

    now_ist = datetime.now(ist)
    hour = now_ist.hour
    today = now_ist.strftime("%d-%m-%Y")

    user_msg_id = update.message.message_id
    chat_id = update.effective_chat.id

    # Check timing
    if not (START_HOUR <= hour < END_HOUR):
        closed_msg = await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Attendance/Leave is closed for today.\n\n⏰ Attendance timing: {START_HOUR}:00 AM – {END_HOUR}:00 AM\n\nPlease try again tomorrow morning."
        )
        await asyncio.sleep(15)
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=closed_msg.message_id)
            await context.bot.delete_message(chat_id=chat_id, message_id=user_msg_id)
        except Exception:
            pass
        return

    # Add attendance
    success = db.add_attendance({
        "date": today,
        "userId": user_id,
        "name": name,
        "username": username,
        "status": status,
        "reason": reason
    })

    if not success:
        dup_msg = await context.bot.send_message(
            chat_id=chat_id,
            text=f"<b>✅ {html.escape(name)}, attendance/leave already marked for today</b>",
            parse_mode="HTML"
        )
        await asyncio.sleep(0.5)
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=user_msg_id)
        except Exception:
            pass
        await asyncio.sleep(9.5)
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=dup_msg.message_id)
        except Exception:
            pass
        return

    # Calculate streak
    streak = 1
    if is_present:
        all_att = db.get_all_attendance()
        check_date = now_ist - timedelta(days=1)
        while True:
            d_str = check_date.strftime("%d-%m-%Y")
            rec = next((r for r in all_att if str(r.get("userId")) == user_id and str(r.get("date")).strip() == d_str), None)
            if rec and str(rec.get("status", "Present")).strip() == "Present":
                streak += 1
                check_date -= timedelta(days=1)
            else:
                break

    badge = ""
    if streak >= 30: badge = " 👑 [Legend]"
    elif streak >= 15: badge = " 🌟 [Gold]"
    elif streak >= 7: badge = " 🔥 [Silver]"
    elif streak >= 3: badge = " ⚡ [Rising Star]"

    reply_text = f"<b>✅ {html.escape(name)}, attendance marked!</b>\n<code>🔥 {streak}-Day Streak!{badge}</code>" if is_present else f"<b>🍂 {html.escape(name)}, leave registered</b>"
    
    succ_msg = await context.bot.send_message(chat_id=chat_id, text=reply_text, parse_mode="HTML")
    await asyncio.sleep(0.5)
    try:
        await context.bot.delete_message(chat_id=chat_id, message_id=user_msg_id)
    except Exception:
        pass
    await asyncio.sleep(29.5)
    try:
        await context.bot.delete_message(chat_id=chat_id, message_id=succ_msg.message_id)
    except Exception:
        pass

async def mystatus(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        user_id = str(update.effective_user.id)
        name = html.escape(update.effective_user.first_name or "Unknown")
        user_msg_id = update.message.message_id
        chat_id = update.effective_chat.id

        all_att = db.get_all_attendance()
        user_rows = [r for r in all_att if str(r.get("userId")) == user_id]
        present_cnt = len([r for r in user_rows if str(r.get("status", "Present")).strip() == "Present"])
        leave_cnt = len([r for r in user_rows if str(r.get("status", "")).strip() == "Leave"])
        total_logs = len(user_rows)
        rate = round((present_cnt / total_logs) * 100) if total_logs > 0 else 0

        now_ist = datetime.now(ist)
        streak = 0
        check_date = now_ist
        while True:
            d_str = check_date.strftime("%d-%m-%Y")
            rec = next((r for r in user_rows if str(r.get("date")).strip() == d_str), None)
            if rec and str(rec.get("status", "Present")).strip() == "Present":
                streak += 1
                check_date -= timedelta(days=1)
            else:
                break

        badge = ""
        if streak >= 30: badge = " 👑 [Legend]"
        elif streak >= 15: badge = " 🌟 [Gold]"
        elif streak >= 7: badge = " 🔥 [Silver]"
        elif streak >= 3: badge = " ⚡ [Rising Star]"

        text = f"<b>📊 ATTENDANCE SUMMARY: {name}</b>\n━━━━━━━━━━━━━━━━━━━━━━\n📅 <b>Total Logs:</b> <code>{total_logs}</code>\n✅ <b>Present Days:</b> <code>{present_cnt}</code>\n🍂 <b>Leave Days:</b> <code>{leave_cnt}</code>\n📈 <b>Attendance Rate:</b> <code>{rate}%</code>\n🔥 <b>Current Streak:</b> <code>{streak} Days{badge}</code>"
        
        msg = await context.bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
        await asyncio.sleep(0.5)
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=user_msg_id)
        except Exception:
            pass
        await asyncio.sleep(59.5)
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=msg.message_id)
        except Exception:
            pass
    except Exception as e:
        print(f"[MYSTATUS ERROR]: {e}")

async def export(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        user_msg_id = update.message.message_id
        chat_id = update.effective_chat.id
        today = datetime.now(ist).strftime("%d-%m-%Y")
        csv_path = db.generate_csv_filepath()
        all_att = db.get_all_attendance()

        with open(csv_path, "rb") as doc:
            await context.bot.send_document(
                chat_id=chat_id,
                document=doc,
                filename=f"attendance_export_{today}.csv",
                caption=f"📊 <b>Attendance Excel/CSV Export</b>\n📅 Generated on: <code>{today}</code>\nTotal Logs: <code>{len(all_att)}</code>",
                parse_mode="HTML"
            )
        await asyncio.sleep(0.5)
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=user_msg_id)
        except Exception:
            pass
    except Exception as e:
        print(f"[EXPORT ERROR]: {e}")

def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(MessageHandler(filters.ALL, track_user), group=1)
    app.add_handler(MessageHandler(filters.Regex(r"(?i)^/present"), present_or_leave))
    app.add_handler(MessageHandler(filters.Regex(r"(?i)^/leave"), present_or_leave))
    app.add_handler(MessageHandler(filters.Regex(r"(?i)^/mystatus"), mystatus))
    app.add_handler(MessageHandler(filters.Regex(r"(?i)^/(downloadreport|attendanceexport|att_export|export)"), export))

    job_queue = app.job_queue
    if job_queue:
        job_queue.run_daily(morning_announcement, time=time(6, 0, tzinfo=ist))
        job_queue.run_daily(night_report, time=time(21, 0, tzinfo=ist))

    print("🚀 Python Telegram Attendance Bot is running...")
    app.run_polling()

if __name__ == "__main__":
    main()
