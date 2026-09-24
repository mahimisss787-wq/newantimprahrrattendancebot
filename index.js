require('dotenv').config();
const { Telegraf } = require('telegraf');
const { DateTime } = require('luxon');
const cron = require('node-cron');
const db = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN || '8974478810:AAEgxD-ikJrMwV_JSBJY9F45ppBhefoZjtg';
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '-1003493006883';

// ⏰ ATTENDANCE TIME WINDOW (IST)
const START_HOUR = parseInt(process.env.ATTENDANCE_START_HOUR || '6');  // Default: 6 AM
const END_HOUR = parseInt(process.env.ATTENDANCE_END_HOUR || '10');     // Default: 10 AM

const bot = new Telegraf(BOT_TOKEN);

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Auto-register members when they send any message
bot.use(async (ctx, next) => {
  if (ctx.from) {
    db.registerMember(ctx.from.id, ctx.from.first_name, ctx.from.username).catch(() => {});
  }
  return next();
});

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
// 2. Cron Job: 9:00 PM Daily Attendance Report Summary + CSV File
// -------------------------------------------------------------
cron.schedule('0 21 * * *', async () => {
  try {
    const members = await db.getAllMembers();
    const attendance = await db.getAllAttendance();

    const today = DateTime.now().setZone('Asia/Kolkata').toFormat('dd-MM-yyyy');
    const yesterday = DateTime.now().setZone('Asia/Kolkata').minus({ days: 1 }).toFormat('dd-MM-yyyy');
    const dayBefore = DateTime.now().setZone('Asia/Kolkata').minus({ days: 2 }).toFormat('dd-MM-yyyy');

    const totalMembersCount = members.length;

    const todayAttendance = attendance.filter(r => String(r.date).trim() === today);
    const presentUsers = todayAttendance.filter(r => String(r.status || 'Present').trim() === 'Present');
    const leaveUsers = todayAttendance.filter(r => String(r.status || '').trim() === 'Leave');

    const presentUserIds = new Set(presentUsers.map(u => String(u.userId)));
    const leaveUserIds = new Set(leaveUsers.map(u => String(u.userId)));

    const absentUsers = members.filter(m => !presentUserIds.has(String(m.userId)) && !leaveUserIds.has(String(m.userId)));

    const warnings = [];
    for (const member of absentUsers) {
      const mId = String(member.userId);
      const attendedYesterday = attendance.some(r => String(r.date).trim() === yesterday && String(r.userId) === mId);
      const attendedDayBefore = attendance.some(r => String(r.date).trim() === dayBefore && String(r.userId) === mId);
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
        const name = escapeHTML(user.name || 'Unknown');
        if (type === 'leave') {
          const reason = escapeHTML(user.reason || 'No reason specified');
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

    // Auto-send Excel/CSV file report
    const filePath = await db.generateCSVFilePath();
    await bot.telegram.sendDocument(GROUP_CHAT_ID, { source: filePath, filename: `attendance_${today}.csv` }, { caption: `📁 Daily Attendance Excel/CSV Export (${today})` });

    console.log('[CRON] 9:00 PM Report & CSV sent successfully.');
  } catch (err) {
    console.error('[CRON ERROR] 9 PM:', err);
  }
}, { timezone: 'Asia/Kolkata' });

// -------------------------------------------------------------
// 3. Command: /export (Download Excel/CSV Report)
// -------------------------------------------------------------
bot.hears(/^\/export(@\w+)?$/i, async (ctx) => {
  const userMessageId = ctx.message.message_id;
  try {
    const today = DateTime.now().setZone('Asia/Kolkata').toFormat('dd-MM-yyyy');
    const filePath = await db.generateCSVFilePath();
    const allAttendance = await db.getAllAttendance();

    await ctx.replyWithDocument({ source: filePath, filename: `attendance_export_${today}.csv` }, {
      caption: `📊 <b>Attendance Excel/CSV Export</b>\n📅 Generated on: <code>${today}</code>\nTotal Logs: <code>${allAttendance.length}</code>`,
      parse_mode: 'HTML'
    });

    // Delete user command after 500ms
    setTimeout(() => {
      ctx.deleteMessage(userMessageId).catch(() => {});
    }, 500);
  } catch (err) {
    console.error('[COMMAND ERROR] /export:', err);
    ctx.reply('⚠️ Failed to generate export file.').catch(() => {});
  }
});

// -------------------------------------------------------------
// 4. Command: /admission form
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
// 5. Command: /mystatus
// -------------------------------------------------------------
bot.hears(/^\/mystatus(@\w+)?$/, async (ctx) => {
  const userId = String(ctx.from.id);
  const name = escapeHTML(ctx.from.first_name || 'Unknown');
  const userMessageId = ctx.message.message_id;

  try {
    const allRows = await db.getAllAttendance();
    const userRows = allRows.filter(r => String(r.userId) === userId);
    const presentCount = userRows.filter(r => String(r.status || 'Present').trim() === 'Present').length;
    const leaveCount = userRows.filter(r => String(r.status || '').trim() === 'Leave').length;
    const totalLogs = userRows.length;
    const attendanceRate = totalLogs > 0 ? Math.round((presentCount / totalLogs) * 100) : 0;

    let streakCount = 0;
    let checkDate = DateTime.now().setZone('Asia/Kolkata');
    while (true) {
      const dateStr = checkDate.toFormat('dd-MM-yyyy');
      const pastRecord = userRows.find(r => String(r.date).trim() === dateStr);
      if (pastRecord && String(pastRecord.status || 'Present').trim() === 'Present') {
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
// 6. Attendance Handler: /present & /leave
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
    const success = await db.addAttendance({
      date: today,
      userId: userId,
      name: name,
      username: username,
      status: status,
      reason: reason
    });

    if (!success) {
      // Already Marked Handler
      const duplicateMsg = await ctx.reply(`<b>✅ ${name}, attendance/leave already marked for today</b>`, { parse_mode: 'HTML' });

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
      const allRows = await db.getAllAttendance();
      streakCount = 1;
      let checkDate = nowKolkata.minus({ days: 1 });
      while (true) {
        const dateStr = checkDate.toFormat('dd-MM-yyyy');
        const pastRecord = allRows.find(r =>
          String(r.userId) === userId &&
          String(r.date).trim() === dateStr
        );
        if (pastRecord && String(pastRecord.status || 'Present').trim() === 'Present') {
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
    ctx.reply('⚠️ Error saving attendance.').catch(() => {});
  }
});

bot.launch().then(() => {
  console.log('🚀 Telegram Attendance Bot (MongoDB Cloud + Local DB + CSV Mode) is running...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
