require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { DateTime } = require('luxon');
const cron = require('node-cron');

const BOT_TOKEN = process.env.BOT_TOKEN || '8974478810:AAEgxD-ikJrMwV_JSBJY9F45ppBhefoZjtg';
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '-1003493006883';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '123XUsCdQRMTt_HtcHclEE8RRoFYoAl27KDBi1Ealn3E';

// ⏰ ATTENDANCE TIME WINDOW (IST) - Railway Variables से बदल सकते हैं
const START_HOUR = parseInt(process.env.ATTENDANCE_START_HOUR || '6');  // Default: 6 AM
const END_HOUR = parseInt(process.env.ATTENDANCE_END_HOUR || '10');     // Default: 10 AM

const bot = new Telegraf(BOT_TOKEN);

// Google Sheets Authentication
async function getDoc() {
  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  // Clean surrounding quotes and format line breaks properly
  key = key.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n');

  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();

  const serviceAccountAuth = new JWT({
    email: email,
    key: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

// Helper to get Attendance Sheet safely
async function getAttendanceSheet(doc) {
  let sheet = doc.sheetsByTitle['Attendance'] || 
              doc.sheetsByTitle['attendance'] || 
              doc.sheetsByTitle['Sheet1'] || 
              doc.sheetsByIndex[0];

  try {
    await sheet.loadHeaderRow();
  } catch (e) {
    console.warn('[SHEET WARN] Could not load header row, setting default headers:', e.message);
    try {
      await sheet.setHeaderRow(['Date', 'User ID', 'Name', 'Username', 'Status', 'Reason']);
    } catch (err) {
      console.error('[SHEET ERROR] Failed setting default header row:', err.message);
    }
  }
  return sheet;
}

// Helper to get Members Sheet safely
async function getMembersSheet(doc) {
  return doc.sheetsByTitle['Members'] || 
         doc.sheetsByTitle['members'] || 
         (doc.sheetsByIndex.length > 1 ? doc.sheetsByIndex[1] : doc.sheetsByIndex[0]);
}

// Build row object dynamically based on sheet's existing headers
function buildRowObject(headerValues, data) {
  if (!headerValues || headerValues.length === 0) {
    return {
      'Date': data.date,
      'User ID': data.userId,
      'Name': data.name,
      'Username': data.username,
      'Status': data.status,
      'Reason': data.reason
    };
  }

  const rowObj = {};
  for (const header of headerValues) {
    const norm = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm === 'date') rowObj[header] = data.date;
    else if (norm === 'userid' || norm === 'id' || norm === 'telegramid' || norm === 'memberid') rowObj[header] = data.userId;
    else if (norm === 'name' || norm === 'fullname' || norm === 'membername') rowObj[header] = data.name;
    else if (norm === 'username') rowObj[header] = data.username;
    else if (norm === 'status') rowObj[header] = data.status;
    else if (norm === 'reason') rowObj[header] = data.reason;
    else rowObj[header] = '';
  }
  return rowObj;
}

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function findUserId(row) {
  const keys = ['User ID', 'UserId', 'user id', 'ID', 'id', 'Telegram ID', 'TelegramID', 'Member ID'];
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return String(row[k]).trim();
    }
  }
  for (const k of Object.keys(row)) {
    const normalized = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === 'userid' || normalized === 'id' || normalized === 'telegramid') {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
        return String(row[k]).trim();
      }
    }
  }
  return '';
}

function findName(row) {
  const keys = ['Name', 'name', 'Full Name', 'fullname', 'Member Name'];
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return String(row[k]).trim();
    }
  }
  for (const k of Object.keys(row)) {
    const normalized = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === 'name' || normalized === 'fullname' || normalized === 'membername') {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
        return String(row[k]).trim();
      }
    }
  }
  return 'Unknown';
}

// -------------------------------------------------------------
// 1. Cron Job: 6:00 AM Daily Morning Announcement Message
// -------------------------------------------------------------
cron.schedule('0 6 * * *', async () => {
  try {
    const msg = `🌸 राधे राधे! आप सभी का स्वागत है। ☀️\n\n💚 Daily Attendance is now OPEN.\n\n⏰ Timing:\n🕕 06:00 AM – 10:00 AM (IST)\n\n📌 Mark your attendance by sending:\n👉🏻 /present\n\n📚 📚 Keep learning. Keep growing.\n✨ Have a wonderful day! 😍`;
    await bot.telegram.sendMessage(GROUP_CHAT_ID, msg);
    console.log('[CRON] 6:00 AM Announcement sent.');
  } catch (err) {
    console.error('[CRON ERROR] 6 AM:', err);
  }
}, { timezone: 'Asia/Kolkata' });

// -------------------------------------------------------------
// 2. Cron Job: 9:00 PM Daily Attendance Report Summary
// -------------------------------------------------------------
cron.schedule('0 21 * * *', async () => {
  try {
    const doc = await getDoc();
    const membersSheet = await getMembersSheet(doc);
    const attendanceSheet = await getAttendanceSheet(doc);

    const rawMembersRows = await membersSheet.getRows();
    const rawAttendanceRows = await attendanceSheet.getRows();

    const today = DateTime.now().setZone('Asia/Kolkata').toFormat('dd-MM-yyyy');
    const yesterday = DateTime.now().setZone('Asia/Kolkata').minus({ days: 1 }).toFormat('dd-MM-yyyy');
    const dayBefore = DateTime.now().setZone('Asia/Kolkata').minus({ days: 2 }).toFormat('dd-MM-yyyy');

    const rawMembers = rawMembersRows.map(r => r.toObject());
    const rawAttendance = rawAttendanceRows.map(r => r.toObject());

    const uniqueMembersMap = new Map();
    for (const m of rawMembers) {
      const uId = findUserId(m);
      if (uId && !uniqueMembersMap.has(uId)) {
        uniqueMembersMap.set(uId, { userId: uId, name: findName(m) });
      }
    }
    const members = Array.from(uniqueMembersMap.values());
    const totalMembersCount = members.length;

    const uniqueAttendanceMap = new Map();
    for (const a of rawAttendance) {
      const uId = findUserId(a);
      const date = String(a['Date'] || a['date'] || '').trim();
      const key = uId + '_' + date;
      if (uId && date && !uniqueAttendanceMap.has(key)) {
        uniqueAttendanceMap.set(key, a);
      }
    }
    const attendance = Array.from(uniqueAttendanceMap.values());

    const todayAttendance = attendance.filter(r => String(r['Date'] || r['date'] || '').trim() === today);
    const presentUsers = todayAttendance.filter(r => String(r['Status'] || r['status'] || 'Present').trim() === 'Present');
    const leaveUsers = todayAttendance.filter(r => String(r['Status'] || r['status'] || '').trim() === 'Leave');

    const presentUserIds = new Set(presentUsers.map(u => findUserId(u)));
    const leaveUserIds = new Set(leaveUsers.map(u => findUserId(u)));

    const absentUsers = members.filter(m => !presentUserIds.has(m.userId) && !leaveUserIds.has(m.userId));

    const warnings = [];
    for (const member of absentUsers) {
      const mId = member.userId;
      const attendedYesterday = attendance.some(r => String(r['Date'] || r['date'] || '').trim() === yesterday && findUserId(r) === mId);
      const attendedDayBefore = attendance.some(r => String(r['Date'] || r['date'] || '').trim() === dayBefore && findUserId(r) === mId);
      if (!attendedYesterday && !attendedDayBefore) {
        warnings.push(member.name);
      }
    }

    function chunkList(users, type) {
      const chunks = [];
      let currentChunk = [];
      let currentLength = 0;
      let counter = 1;
      for (const user of users) {
        let line = '';
        const name = escapeHTML(user.name || user.Name || 'Unknown');
        if (type === 'leave') {
          const reason = escapeHTML(user.Reason || user.reason || 'No reason specified');
          line = `  <b>${counter}.</b> <code>${name}</code>\n     ┗ <i>${reason}</i>\n`;
        } else {
          line = `  <b>${counter}.</b> <code>${name}</code>\n`;
        }

        if (currentLength + line.length > 3000) {
          chunks.push(currentChunk.join(''));
          currentChunk = [line];
          currentLength = line.length;
        } else {
          currentChunk.push(line);
          currentLength += line.length;
        }
        counter++;
      }
      if (currentChunk.length > 0) chunks.push(currentChunk.join(''));
      return chunks;
    }

    function chunkWarnings(warningList) {
      const chunks = [];
      let currentChunk = [];
      let currentLength = 0;
      let counter = 1;
      for (const name of warningList) {
        const line = `  <b>${counter}.</b> <code>${escapeHTML(name)}</code> ⚠️\n`;
        if (currentLength + line.length > 3000) {
          chunks.push(currentChunk.join(''));
          currentChunk = [line];
          currentLength = line.length;
        } else {
          currentChunk.push(line);
          currentLength += line.length;
        }
        counter++;
      }
      if (currentChunk.length > 0) chunks.push(currentChunk.join(''));
      return chunks;
    }

    const presentChunks = chunkList(presentUsers, 'present');
    const leaveChunks = chunkList(leaveUsers, 'leave');
    const absentChunks = chunkList(absentUsers, 'absent');
    const warningChunks = chunkWarnings(warnings);

    const divider = '━━━━━━━━━━━━━━━━━━━━━━\n';
    let msg1 = `<b>📊 DAILY ATTENDANCE REPORT</b>\n${divider}📅 <b>Date:</b> <code>${today}</code>\n👥 <b>Total Members:</b> <code>${totalMembersCount}</code>\n${divider}✅ <b>Present Count:</b> <code>${presentUsers.length}</code>\n\n`;
    if (presentChunks.length > 0) {
      msg1 += `📝 <b>Present Members (Part 1):</b>\n${presentChunks[0]}`;
    } else {
      msg1 += `📝 <b>Present Members:</b>\n  <i>None</i>`;
    }
    await bot.telegram.sendMessage(GROUP_CHAT_ID, msg1, { parse_mode: 'HTML' });

    for (let i = 1; i < presentChunks.length; i++) {
      await bot.telegram.sendMessage(GROUP_CHAT_ID, `📝 <b>Present Members (Part ${i + 1}):</b>\n${presentChunks[i]}`, { parse_mode: 'HTML' });
    }

    let leaveMsg = `🍂 <b>ON LEAVE COUNT: ${leaveUsers.length}</b>\n${divider}`;
    if (leaveChunks.length > 0) leaveMsg += `📝 <b>Leave Registered:</b>\n${leaveChunks.join('')}`;
    else leaveMsg += `📝 <b>Leave Registered:</b>\n  <i>None</i>`;
    await bot.telegram.sendMessage(GROUP_CHAT_ID, leaveMsg, { parse_mode: 'HTML' });

    let absentMsg = `❌ <b>ABSENT COUNT: ${absentUsers.length}</b>\n${divider}`;
    if (absentChunks.length > 0) absentMsg += `📝 <b>Absent Members:</b>\n${absentChunks.join('')}`;
    else absentMsg += `📝 <b>Absent Members:</b>\n  <i>None</i>`;
    absentMsg += '\n⚠️ <b>Consecutive Absentees (3+ days):</b>\n';
    if (warningChunks.length > 0) absentMsg += warningChunks.join('');
    else absentMsg += '  <i>None</i>';

    await bot.telegram.sendMessage(GROUP_CHAT_ID, absentMsg, { parse_mode: 'HTML' });
    console.log('[CRON] 9:00 PM Report sent successfully.');
  } catch (err) {
    console.error('[CRON ERROR] 9 PM:', err);
  }
}, { timezone: 'Asia/Kolkata' });

// -------------------------------------------------------------
// 3. Command: /admission form
// -------------------------------------------------------------
bot.hears(/^\/[Aa]dmission ?[Ff]orm$/, async (ctx) => {
  try {
    const text = `📄 Admission Form\n\n🔗 https://admissionverify.infinityfreeapp.com/\n\nPlease fill the form carefully. ✅`;
    await ctx.reply(text);
  } catch (err) {
    console.error('[COMMAND ERROR] Admission Form:', err);
  }
});

// -------------------------------------------------------------
// 4. Command: /mystatus
// -------------------------------------------------------------
bot.hears(/^\/mystatus(@\w+)?$/, async (ctx) => {
  const userId = String(ctx.from.id);
  const name = escapeHTML(ctx.from.first_name || 'Unknown');
  const userMessageId = ctx.message.message_id;

  try {
    const doc = await getDoc();
    const sheet = await getAttendanceSheet(doc);
    const rows = await sheet.getRows();
    const allRows = rows.map(r => r.toObject());

    const userRows = allRows.filter(r => findUserId(r) === userId);
    const presentCount = userRows.filter(r => String(r['Status'] || r['status'] || 'Present').trim() === 'Present').length;
    const leaveCount = userRows.filter(r => String(r['Status'] || r['status'] || '').trim() === 'Leave').length;
    const totalLogs = userRows.length;
    const attendanceRate = totalLogs > 0 ? Math.round((presentCount / totalLogs) * 100) : 0;

    let streakCount = 0;
    let checkDate = DateTime.now().setZone('Asia/Kolkata');
    while (true) {
      const dateStr = checkDate.toFormat('dd-MM-yyyy');
      const pastRecord = userRows.find(r => String(r['Date'] || r['date'] || '').trim() === dateStr);
      if (pastRecord && String(pastRecord['Status'] || pastRecord['status'] || 'Present').trim() === 'Present') {
        streakCount++;
        checkDate = checkDate.minus({ days: 1 });
      } else {
        break;
      }
    }

    let badge = '';
    if (streakCount >= 30) badge = ' 👑 [Legend]';
    else if (streakCount >= 15) badge = ' 🌟 [Gold]';
    else if (streakCount >= 7) badge = ' 🔥 [Silver]';
    else if (streakCount >= 3) badge = ' ⚡ [Rising Star]';

    const text = `<b>📊 ATTENDANCE SUMMARY: ${name}</b>\n━━━━━━━━━━━━━━━━━━━━━━\n📅 <b>Total Logs:</b> <code>${totalLogs}</code>\n✅ <b>Present Days:</b> <code>${presentCount}</code>\n🍂 <b>Leave Days:</b> <code>${leaveCount}</code>\n📈 <b>Attendance Rate:</b> <code>${attendanceRate}%</code>\n🔥 <b>Current Streak:</b> <code>${streakCount} Days${badge}</code>`;

    const statusMsg = await ctx.reply(text, { parse_mode: 'HTML' });

    // Delete user command immediately
    setTimeout(() => {
      ctx.deleteMessage(userMessageId).catch(() => {});
    }, 500);

    // Auto-delete status card after 60 seconds
    setTimeout(() => {
      ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }, 60000);

  } catch (err) {
    console.error('[COMMAND ERROR] /mystatus:', err);
  }
});

// -------------------------------------------------------------
// 5. Attendance Handler: /present & /leave
// -------------------------------------------------------------
bot.hears(/^(\/present|\/leave)(@\w+)?( .*)?$/i, async (ctx) => {
  if (ctx.chat.type === 'private') return;

  const nowKolkata = DateTime.now().setZone('Asia/Kolkata');
  const hour = nowKolkata.hour;
  const attendanceOpen = hour >= START_HOUR && hour < END_HOUR;

  const userId = String(ctx.from.id);
  const name = ctx.from.first_name || 'Unknown';
  const username = ctx.from.username || '';
  const userText = ctx.message.text.trim();
  const isPresent = userText.toLowerCase().startsWith('/present');
  const status = isPresent ? 'Present' : 'Leave';
  const reason = !isPresent ? (userText.split(' ').slice(1).join(' ') || 'No reason specified') : '';
  const today = nowKolkata.toFormat('dd-MM-yyyy');

  const userMessageId = ctx.message.message_id;

  // CLOSED TIMING HANDLER
  if (!attendanceOpen) {
    const closedMsgText = `❌ Attendance/Leave is closed for today.\n\n⏰ Attendance timing: ${START_HOUR}:00 AM – ${END_HOUR}:00 AM\n\nPlease try again tomorrow morning.`;
    const closedMsg = await ctx.reply(closedMsgText);

    setTimeout(() => {
      ctx.deleteMessage(closedMsg.message_id).catch(() => {});
      ctx.deleteMessage(userMessageId).catch(() => {});
    }, 15000); // 15 seconds auto-delete
    return;
  }

  // OPEN TIMING HANDLER
  try {
    const doc = await getDoc();
    const sheet = await getAttendanceSheet(doc);
    const rows = await sheet.getRows();
    const allRows = rows.map(r => r.toObject());

    const already = allRows.find(r =>
      String(r['Date'] || r['date'] || '').trim() === today &&
      findUserId(r) === userId
    );

    if (already) {
      // Already Marked Handler
      const duplicateMsg = await ctx.reply(`<b>✅ ${name}, attendance/leave already marked</b>`, { parse_mode: 'HTML' });

      setTimeout(() => {
        ctx.deleteMessage(userMessageId).catch(() => {});
      }, 500);

      setTimeout(() => {
        ctx.deleteMessage(duplicateMsg.message_id).catch(() => {});
      }, 10000); // Delete duplicate notice after 10s
      return;
    }

    // Calculate Streak
    let streakCount = 0;
    if (isPresent) {
      streakCount = 1;
      let checkDate = nowKolkata.minus({ days: 1 });
      while (true) {
        const dateStr = checkDate.toFormat('dd-MM-yyyy');
        const pastRecord = allRows.find(r =>
          findUserId(r) === userId &&
          String(r['Date'] || r['date'] || '').trim() === dateStr
        );
        if (pastRecord && String(pastRecord['Status'] || pastRecord['status'] || 'Present').trim() === 'Present') {
          streakCount++;
          checkDate = checkDate.minus({ days: 1 });
        } else {
          break;
        }
      }
    }

    let badge = '';
    if (streakCount >= 30) badge = ' 👑 [Legend]';
    else if (streakCount >= 15) badge = ' 🌟 [Gold]';
    else if (streakCount >= 7) badge = ' 🔥 [Silver]';
    else if (streakCount >= 3) badge = ' ⚡ [Rising Star]';

    // Append to Google Sheets with dynamic header matching
    const rowObj = buildRowObject(sheet.headerValues || [], {
      date: today,
      userId: userId,
      name: name,
      username: username,
      status: status,
      reason: reason
    });

    await sheet.addRow(rowObj);

    let replyText = isPresent
      ? `<b>✅ ${name}, attendance marked!</b>\n<code>🔥 ${streakCount}-Day Streak!${badge}</code>`
      : `<b>🍂 ${name}, leave registered</b>`;

    const successMsg = await ctx.reply(replyText, { parse_mode: 'HTML' });

    // Delete user command immediately
    setTimeout(() => {
      ctx.deleteMessage(userMessageId).catch(() => {});
    }, 500);

    // Delete success message after 30 seconds
    setTimeout(() => {
      ctx.deleteMessage(successMsg.message_id).catch(() => {});
    }, 30000);

  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err);
    try {
      const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'service account email';
      const errMsg = `⚠️ <b>Google Sheet Error!</b>\n\nData save nahi ho paya:\n<code>${escapeHTML(err.message || err)}</code>\n\n📌 <b>Fix:</b> Make sure your Google Sheet is shared with <b>Editor</b> access to:\n<code>${escapeHTML(email)}</code>`;
      const errNotice = await ctx.reply(errMsg, { parse_mode: 'HTML' });

      setTimeout(() => {
        ctx.deleteMessage(userMessageId).catch(() => {});
      }, 500);

      setTimeout(() => {
        ctx.deleteMessage(errNotice.message_id).catch(() => {});
      }, 25000);
    } catch (e) {
      console.error('[ERROR NOTICE FAILED]:', e);
    }
  }
});

bot.launch().then(() => {
  console.log('🚀 Telegram Attendance Bot is running...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

