// app.js: the BEHAVIOR of the "Overlap" website.
//
// JavaScript is the programming language that makes web pages interactive. This file does the real work:
//   1. reads calendar files (the .ics format) that you give it,
//   2. works out when each person is busy,
//   3. finds the gaps when everyone is free,
//   4. draws the results on the page and reacts to your clicks.
//
// HOW TO READ THIS FILE. Lines starting with // (like these) are comments: notes for humans that the
// computer ignores. A "variable" is a named box that holds a value. A "function" is a named recipe of steps
// you can run whenever you want by writing its name followed by parentheses.
//
// The file is organized in sections, from the basic building blocks to the code that reacts to the user:
// tiny helpers, time zones, reading .ics files, repeating events, state, formatting, adding calendars,
// computing free time, drawing the page, actions, sample data, wiring up events, saving settings, start-up.
"use strict";
// The next line turns on "strict mode". It makes JavaScript stricter about mistakes (for example, using a
// variable you forgot to create), so bugs are caught early instead of being silently ignored.
/* ---------- tiny helpers ---------- */
// const creates a variable whose value can never be reassigned (a "constant").
// This one is a tiny shortcut function. "s => ..." is an "arrow function": a short way to write a function,
// where s is the input (called a parameter) and the part after => is what it gives back.
// document is the web page, and document.querySelector(s) finds the first element on it that matches a
// CSS selector like '#people' (the element with id="people"). The page's tree of elements is called the
// DOM (Document Object Model). After this line, $('#people') means "find the element with id people".
const $ = s => document.querySelector(s);
// esc makes text safe to put inside HTML. Characters like < and & have special meaning in HTML, so
// each is swapped for a harmless code (for example < becomes &lt;). This is called "escaping".
// Why it matters: calendar files come from outside. If a calendar event were named
// "<script>bad stuff</script>", showing it without escaping could run that code. This prevents that.
// The pieces: String(s) makes sure we have text (a "string"); .replace() swaps matching parts; the part
// between slashes /[&<>"']/g is a "regular expression", a pattern that matches those five characters (g = every
// match); and the { ... } lookup is an "object", a table that pairs each character with its safe replacement.
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Computers store a moment in time as a count of milliseconds (thousandths of a second). So one minute is
// 60,000 and one day is 86,400,000 (24 x 60 x 60 x 1000). Giving these numbers names makes the math
// below readable: "15*MIN" is clearer than "900000".
const MIN = 60000, DAY = 86400000;
// SAFETY LIMITS. Calendar files can come from anywhere, so we cap how much we are willing to handle.
// Without limits, a gigantic or malicious file could freeze your browser.
// Total events across all calendars:
const MAX_TOTAL_EVENTS = 60000;
// Biggest file (10 megabytes), most events in one file, most people, and the "work budget": how many
// steps the repeating-event code may take before it gives up.
const MAX_BYTES = 10*1024*1024, MAX_EVENTS = 20000, MAX_PEOPLE = 24, WORK_BUDGET = 600000;
// BUDGET counts down the remaining work. {n: ..., hit: false} is an object, a bundle of named values:
// n = steps left, hit = did we run out? (false = no, so far; true/false values are called booleans).
const BUDGET = {n: WORK_BUDGET, hit: false};
// An "array" is an ordered list written in square brackets. These are eight hex color codes, one per person.
// They were chosen to be easy to tell apart, including for people with color-blindness.
const COLORS = ['#0072B2','#D55E00','#009E73','#CC79A7','#E69F00','#56B4E9','#7A5195','#8C564B'];
// Day-of-week names. Arrays are counted from 0, so DOW[0] is 'Sun' and DOW[6] is 'Sat'.
// JavaScript also numbers days this way (0 = Sunday).
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
// Calendar files write weekdays as two-letter codes (MO, TU, ...). This object converts each code to the
// number used above, e.g. DOWCODE.MO is 1.
const DOWCODE = {SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6};
// The time zone of the person using the page, such as 'America/Denver'. A time zone is a region that shares
// the same clock time. Intl is a built-in tool for dates, numbers and languages. The || means "or": if the
// browser cannot tell us, use 'UTC' (the world's standard reference time) instead.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/* ---------- time zones ---------- */
// Outlook calendars name time zones differently (like "Eastern Standard Time") from the standard names used by
// browsers (like "America/New_York"). This object is a translation table from the first kind to the second.
const WIN_TZ = {"Eastern Standard Time":"America/New_York","Central Standard Time":"America/Chicago","Mountain Standard Time":"America/Denver","Pacific Standard Time":"America/Los_Angeles","US Mountain Standard Time":"America/Phoenix","Alaskan Standard Time":"America/Anchorage","Hawaiian Standard Time":"Pacific/Honolulu","GMT Standard Time":"Europe/London","Greenwich Standard Time":"Atlantic/Reykjavik","W. Europe Standard Time":"Europe/Berlin","Romance Standard Time":"Europe/Paris","Central Europe Standard Time":"Europe/Budapest","Central European Standard Time":"Europe/Warsaw","E. Europe Standard Time":"Europe/Chisinau","India Standard Time":"Asia/Kolkata","China Standard Time":"Asia/Shanghai","Tokyo Standard Time":"Asia/Tokyo","Korea Standard Time":"Asia/Seoul","AUS Eastern Standard Time":"Australia/Sydney","E. Australia Standard Time":"Australia/Brisbane","New Zealand Standard Time":"Pacific/Auckland","UTC":"UTC","Singapore Standard Time":"Asia/Singapore","Arabian Standard Time":"Asia/Dubai","Israel Standard Time":"Asia/Jerusalem","South Africa Standard Time":"Africa/Johannesburg","E. South America Standard Time":"America/Sao_Paulo","Canada Central Standard Time":"America/Regina","Atlantic Standard Time":"America/Halifax"};
// A "cache": a place to remember answers we already worked out, so we do not repeat slow work.
const tzOk = {};
// resolveTz turns whatever time zone name a calendar file uses into one the browser understands.
// It returns the working name, or null (JavaScript's word for "nothing / no answer") if none works.
// The input in parentheses (tz) is called a parameter.
function resolveTz(tz){
  if(!tz) return null;
  // If we already tried this name before, return the remembered answer right away.
  // (An "if" runs the code after it only when its condition is true.)
  if(tz in tzOk) return tzOk[tz];
  // A list of names to try, from most likely to least likely: the name as given, its Windows translation,
  // and shortened versions of it.
  const tries = [tz, WIN_TZ[tz], tz.split('/').slice(-2).join('/'), tz.split('/').slice(-1)[0]];
  // A "loop": repeat the steps for each name in the list, one after another.
  for(const t of tries){
    if(!t) continue;
    // try/catch is a safety net. The code in try{ } might cause an error. If it does, instead of crashing,
    // JavaScript jumps to catch and carries on. Here, asking the browser to use an unknown time zone causes
    // an error, which simply tells us "this name does not work, try the next one".
    try{ new Intl.DateTimeFormat('en-US',{timeZone:t}); return (tzOk[tz]=t); }catch(e){}
  }
  return (tzOk[tz]=null);
}
// Another cache. Creating a date formatter is slow, so we keep each one after making it.
const dtfCache = {};
// Gets (or creates) a formatter for a time zone. A formatter can describe a moment in time, such as
// "year 2026, month 11, day 18, hour 9", as the wall clock in that zone would show it.
function dtf(tz){
  return dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}));
}
// Works out the "offset" of a time zone at a moment: how far its clock is ahead of or behind UTC, in
// milliseconds. For example, Denver in winter is 7 hours behind UTC. The offset changes during the year
// because of daylight saving time, which is why we ask for a specific moment (ts is a "timestamp").
function offsetAt(tz, ts){
  const p = {};
  dtf(tz).formatToParts(new Date(ts)).forEach(x => p[x.type] = x.value);
  return Date.UTC(+p.year, +p.month-1, +p.day, (+p.hour)%24, +p.minute, +p.second) - Math.floor(ts/1000)*1000;
}
// Converts "9:00 AM on Nov 18 as shown on a clock in Denver" into one exact moment in time (a timestamp).
// This is the key step for comparing calendars from different time zones.
// It makes a first guess and then corrects it once, because the clock's offset can be different at the
// corrected time (for example, right around a daylight saving change).
function zonedToUtc(y,m,d,h,mi,s,tz){
  const guess = Date.UTC(y,m-1,d,h,mi,s);
  const o1 = offsetAt(tz, guess);
  let t = guess - o1;
  const o2 = offsetAt(tz, t);
  if(o2 !== o1) t = guess - o2;
  return t;
}

/* ---------- ICS parsing ---------- */
// READING .ICS FILES. An .ics file is plain text made of lines like  DTSTART;TZID=America/Denver:20261118T090000
// which means: a property name, optional extra settings after a semicolon, a colon, then the value.
// (The part before the colon and the part after it are handled by the next functions.)
// splitUnquoted cuts a piece of text at every separator character, except separators inside quotation marks.
function splitUnquoted(str, sep){
  const out = []; let cur = '', q = false;
  for(const c of str){
    if(c === '"') q = !q;
    if(c === sep && !q){ out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
// To "parse" is to take raw text and break it into meaningful parts. This function splits one line of the
// file into its three pieces: the name (DTSTART), the settings (such as TZID=America/Denver) and the value.
function parseLine(line){
  let q = false, idx = -1;
  for(let i=0;i<line.length;i++){
    const c = line[i];
    if(c === '"') q = !q;
    else if(c === ':' && !q){ idx = i; break; }
  }
  if(idx < 0) return null;
  const parts = splitUnquoted(line.slice(0,idx), ';');
  const name = parts.shift().toUpperCase();
  const params = {};
  parts.forEach(p => { const e = p.indexOf('='); if(e > 0) params[p.slice(0,e).toUpperCase()] = p.slice(e+1).replace(/^"|"$/g,''); });
  return {name, params, value: line.slice(idx+1)};
}
// Parses a date-time such as 20261118T093000Z (year 2026, month 11, day 18, 09:30:00, the Z meaning UTC).
// The long pattern in slashes is a regular expression (a text pattern) with groups () that capture each number.
// It also detects "all-day" events (date only, no time) and which time zone the time belongs to.
function parseDT(prop){
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/i.exec((prop.value||'').trim());
  if(!m) return null;
  const allDay = prop.params.VALUE === 'DATE' || m[4] === undefined;
  return {allDay, y:+m[1], m:+m[2], d:+m[3], h:+(m[4]||0), mi:+(m[5]||0), s:+(m[6]||0), utc:!!m[7], tz: m[7] ? null : resolveTz(prop.params.TZID)};
}
// Turns a parsed date-time into a single timestamp (milliseconds), choosing the right method for each
// kind: all-day, UTC time, time in a named zone, or "floating" time (no zone given, so use this computer's).
function dtToTs(dt){
  if(dt.allDay) return new Date(dt.y, dt.m-1, dt.d).getTime();
  if(dt.utc) return Date.UTC(dt.y,dt.m-1,dt.d,dt.h,dt.mi,dt.s);
  if(dt.tz) return zonedToUtc(dt.y,dt.m,dt.d,dt.h,dt.mi,dt.s,dt.tz);
  return new Date(dt.y,dt.m-1,dt.d,dt.h,dt.mi,dt.s).getTime();
}
// Some events give a length instead of an end time, written like PT1H30M (1 hour, 30 minutes) or P1D
// (1 day). This converts that into milliseconds.
function parseDuration(v){
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec((v||'').trim());
  if(!m) return null;
  const ms = ((+m[2]||0)*7*24*3600 + (+m[3]||0)*24*3600 + (+m[4]||0)*3600 + (+m[5]||0)*60 + (+m[6]||0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}
// Calendar files write special characters with backslashes (such as \, for a comma). This undoes that so
// titles read normally.
const unesc = s => (s||'').replace(/\\n/gi,' ').replace(/\\([,;\\])/g,'$1');

// parseICS reads a whole calendar file's text and returns the events in it.
// The big picture: split the text into lines, collect the lines between BEGIN:VEVENT and END:VEVENT
// (one event each), then turn each group into a tidy event object.
function parseICS(text){
  // Line endings differ between computers, so first make them all the same. Then "unfold" long lines:
  // the calendar format breaks long lines and starts the continuation with a space, so we glue those back
  // together. Finally split() cuts the text into a list of lines.
  const lines = text.replace(/\r\n?/g,'\n').replace(/\n[ \t]/g,'').split('\n');
  // let makes a variable whose value CAN change later. cur holds the event currently being read, skip tracks
  // nested sections we want to ignore, and vevents collects all the finished events.
  let calName = '', cur = null, skip = 0, vevents = [];
  // Go through the file one line at a time.
  for(const raw of lines){
    const line = raw.trimEnd();
    if(!line) continue;
    const u = line.toUpperCase();
    // BEGIN:VEVENT starts a new event; END:VEVENT finishes it and files it away. (u is the line in
    // capital letters so upper/lower case does not matter, and === means "is exactly equal to".)
    if(u === 'BEGIN:VEVENT'){ cur = {}; skip = 0; continue; }
    if(u === 'END:VEVENT'){ if(cur) vevents.push(cur); cur = null; continue; }
    // While inside an event, ignore nested sections (such as VALARM, a reminder alarm) because they are not
    // part of when the event happens. skip counts how deep we are inside such a section.
    if(cur){
      if(u.startsWith('BEGIN:')){ skip++; continue; }
      if(u.startsWith('END:')){ skip = Math.max(0, skip-1); continue; }
      if(skip) continue;
    }
    // Break the line into name / settings / value. If it cannot be understood, skip it.
    // Inside an event, store it under its name; outside events, look for the calendar's own name.
    const p = parseLine(line);
    if(!p) continue;
    // Store the property in the current event, or remember the calendar name if we are not inside an event.
    if(cur){ (cur[p.name] = cur[p.name] || []).push(p); }
    else if(p.name === 'X-WR-CALNAME' && !calName) calName = unesc(p.value);
  }
  // Refuse files with too many events. "throw new Error(...)" stops the function and reports a problem;
  // the code that called this function catches it and shows the message to the user.
  if(vevents.length > MAX_EVENTS) throw new Error('That calendar has over '+MAX_EVENTS.toLocaleString()+' events, which is too many to load safely. Export a shorter date range.');
  // Turn each raw event into a tidy object with buildEvent. Some events are "overrides": a one-time edit
  // of a single occurrence of a repeating event (for example, moving one Tuesday meeting). They go in a
  // separate list for now.
  const events = [], overrides = [];
  for(const v of vevents){
    const ev = buildEvent(v);
    if(!ev) continue;
    (ev.recId != null ? overrides : events).push(ev);
  }
  // an edited single occurrence replaces that slot of its series
  // For every override, find the repeating event it belongs to (they share a UID, a unique id) and tell
  // that series to skip the original occurrence. Then keep the override as its own event.
  for(const o of overrides){
    const master = events.find(e => e.uid && e.uid === o.uid && e.rrule);
    if(master) master.skip.add(o.recId);
    events.push(o);
  }
  // Give back the calendar's name, its events, how many there are, and how many repeat in a way
  // we cannot fully understand.
  return {calName, events, total: events.length, unsupported: events.filter(e => e.unsupported).length};
}
// buildEvent turns the raw lines of one event into a tidy object with a start, a length and (maybe)
// a repeat rule. It returns null when the event should be ignored, such as cancelled events.
function buildEvent(p){
  // g is a small helper: "get the first line with this property name", or nothing if there is none.
  const g = n => p[n] && p[n][0];
  const ds = g('DTSTART'); if(!ds) return null;
  // Ignore events that are cancelled or marked "transparent" (calendar apps use that to mean "show me as
  // free", for example a birthday reminder), because they should not make anyone busy.
  if(((g('STATUS')||{}).value||'').toUpperCase() === 'CANCELLED') return null;
  if(((g('TRANSP')||{}).value||'').toUpperCase() === 'TRANSPARENT') return null;
  // Read the start time. An event with no usable start cannot be used.
  const start = parseDT(ds); if(!start) return null;
  // Work out how long the event lasts: from an end time (DTEND) if there is one, otherwise from a
  // DURATION. All-day events are counted in days, other events in milliseconds.
  let allDay = start.allDay, days = 1, dur = 0;
  const de = g('DTEND'), du = g('DURATION');
  if(de){
    const end = parseDT(de);
    if(end){
      if(allDay) days = Math.max(1, Math.round((Date.UTC(end.y,end.m-1,end.d) - Date.UTC(start.y,start.m-1,start.d))/DAY));
      else dur = dtToTs(end) - dtToTs(start);
    }
  } else if(du){
    const ms = parseDuration(du.value) || 0;
    if(allDay) days = Math.max(1, Math.round(ms/DAY)); else dur = ms;
  }
  // A timed event with no length cannot make anyone busy, so ignore it. (! means "not", && means "and".)
  if(!allDay && dur <= 0) return null;
  // RRULE is a repeat rule such as "every week on Monday and Wednesday". It arrives as text like
  // FREQ=WEEKLY;BYDAY=MO,WE, which we split into a lookup table (an object) of named parts.
  // We also note rules we cannot fully handle (such as repeating every hour) so we can warn the user.
  let rrule = null, unsupported = false;
  const rr = g('RRULE');
  if(rr){
    rrule = {};
    rr.value.split(';').forEach(kv => { const i = kv.indexOf('='); if(i>0) rrule[kv.slice(0,i).toUpperCase()] = kv.slice(i+1); });
    if(!rrule.FREQ) rrule = null;
    else unsupported = ['BYWEEKNO','BYYEARDAY','BYHOUR','BYMINUTE','BYSECOND'].some(k => k in rrule) || !['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(rrule.FREQ.toUpperCase());
  }
  // EXDATE lists dates when a repeating event is cancelled. A "Set" is a collection that holds each value
  // only once and answers "do you contain this?" very quickly. We collect those dates as timestamps.
  const skip = new Set();
  (p['EXDATE']||[]).forEach(x => x.value.split(',').forEach(val => {
    const dt = parseDT({value:val, params:Object.assign({}, x.params)});
    if(dt) skip.add(dtToTs(dt));
  }));
  // RECURRENCE-ID marks an override: this event replaces one particular occurrence of a repeating series.
  const rid = g('RECURRENCE-ID');
  let recId = null;
  if(rid){ const dt = parseDT(rid); if(dt) recId = dtToTs(dt); }
  // Gather everything into one event object and give it back. If an event has no title, call it 'Busy'.
  return {uid:(g('UID')||{}).value, title: unesc((g('SUMMARY')||{}).value) || 'Busy', start, allDay, days, dur, rrule, skip, recId, unsupported};
}

/* expand one event into [start,end,title] busy intervals overlapping [from,to] */
// REPEATING EVENTS. A repeating event (like "every Tuesday") is stored once, but we need every actual
// occurrence between two dates. expandEvent works those out and adds one [start, end, title, allDay]
// entry per occurrence to the list called out. "from" and "to" limit the dates we care about.
function expandEvent(ev, from, to, out){
  const st = ev.start;
  // mk builds the start and end timestamps for the occurrence on a given year (y), month (m) and day (d),
  // at the event's usual time of day in its own time zone.
  const mk = (y,m,d) => {
    if(ev.allDay){ const s = new Date(y,m-1,d).getTime(); return [s, new Date(y,m-1,d+ev.days).getTime()]; }
    let s;
    if(st.utc) s = Date.UTC(y,m-1,d,st.h,st.mi,st.s);
    else if(st.tz) s = zonedToUtc(y,m,d,st.h,st.mi,st.s,st.tz);
    else s = new Date(y,m-1,d,st.h,st.mi,st.s).getTime();
    return [s, s + ev.dur];
  };
  // Simple case: an event that does not repeat (or repeats in a way we cannot read) counts once.
  // It is added only if it overlaps the period we are looking at.
  if(!ev.rrule || ev.unsupported){
    const [s,e] = mk(st.y,st.m,st.d);
    if(e > from && s < to) out.push([s,e,ev.title,ev.allDay]);
    return;
  }
  // Read the parts of the repeat rule: how often (FREQ, such as DAILY or WEEKLY), every how many (INTERVAL),
  // the maximum number of times (COUNT) and the last date (UNTIL).
  const r = ev.rrule, freq = r.FREQ.toUpperCase(), interval = Math.max(1, +r.INTERVAL || 1);
  const maxCount = r.COUNT ? +r.COUNT : Infinity;
  let untilTs = Infinity;
  if(r.UNTIL){
    const ud = parseDT({value:r.UNTIL, params:{}});
    if(ud){ untilTs = dtToTs(ud); if(ud.allDay) untilTs += DAY; }
  }
  // BYDAY says which weekdays; it can be like "MO,WE" or with a position like "-1FR" (the last Friday).
  // BYMONTHDAY and BYMONTH name days of the month and months of the year. The .map() steps turn each piece
  // of text into a tidy value, and .filter(Boolean) throws away any piece that could not be read.
  const byday = r.BYDAY ? r.BYDAY.split(',').map(x => {
    const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.trim().toUpperCase());
    return m ? {n: m[1] ? +m[1] : 0, dow: DOWCODE[m[2]]} : null;
  }).filter(Boolean) : [];
  const bymonthday = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : [];
  const bymonth = r.BYMONTH ? r.BYMONTH.split(',').map(Number) : [];
  // The first day of the series, as a number we can add days to, and which weekday it falls on.
  const base = Date.UTC(st.y, st.m-1, st.d);
  const baseDow = new Date(base).getUTCDay();
  // count = how many occurrences we have produced so far; done = set to true when we should stop.
  let count = 0, done = false;

  // WKST says which day a week starts on (default Monday). ?? supplies a default if the lookup finds nothing.
  const wkst = DOWCODE[(r.WKST || 'MO').toUpperCase()] ?? 1;
  // passes checks whether a given day is allowed by the rule's filters (month, weekday, day of the month).
  const passes = (dayMs, isDaily) => {
    const dt = new Date(dayMs);
    if(bymonth.length && !bymonth.includes(dt.getUTCMonth()+1)) return false;
    if(isDaily){
      if(byday.length && !byday.some(b => b.dow === dt.getUTCDay())) return false;
      if(bymonthday.length){
        const dim = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth()+1, 0)).getUTCDate(), dd = dt.getUTCDate();
        if(!bymonthday.some(x => x > 0 ? x === dd : dim + x + 1 === dd)) return false;
      }
    }
    return true;
  };
  // emit handles one candidate day: it stops everything if we are past the end of the series, counts the
  // occurrence, skips it if it was cancelled, and otherwise adds it to the results if it overlaps the period we need.
  const emit = (dayMs) => {
    if(dayMs < base) return;
    const dt = new Date(dayMs);
    const [s,e] = mk(dt.getUTCFullYear(), dt.getUTCMonth()+1, dt.getUTCDate());
    if(s > untilTs || count >= maxCount || s >= to + DAY){ done = true; return; }
    count++;
    if(ev.skip.has(s)) return;
    if(e > from && s < to) out.push([s,e,ev.title,ev.allDay]);
  };
  // Finds days such as "the 2nd Tuesday" or "the last Friday" of a month. n is the position (negative counts
  // from the end; 0 means every such weekday).
  const nthWeekday = (y, mo, n, dow) => {
    const first = new Date(Date.UTC(y,mo,1)).getUTCDay();
    const dim = new Date(Date.UTC(y,mo+1,0)).getUTCDate();
    const days = []; for(let d = 1 + ((dow - first + 7) % 7); d <= dim; d += 7) days.push(d);
    if(!n) return days;
    const pick = n > 0 ? days[n-1] : days[days.length + n];
    return pick ? [pick] : [];
  };
  // The main loop: step through the repeats one period at a time (k = 0, 1, 2, ...). It is capped at 20,000
  // steps and uses the shared work budget, so a strange rule can never run forever. An if / else if / else
  // chain then handles each kind of repeat: DAILY, WEEKLY, MONTHLY or YEARLY (anything else stops the loop).
  for(let k = 0; k < 20000 && !done; k++){
    if(--BUDGET.n < 0){ BUDGET.hit = true; break; }
    if(freq === 'DAILY'){
      const dayMs = base + k*interval*DAY;
      if(!passes(dayMs, true)) continue;
      emit(dayMs);
    } else if(freq === 'WEEKLY'){
      // WEEKLY: find the start of the week, then step forward week by week (or every 2 weeks, etc.) and emit each
      // chosen weekday.
      const wkBase = base - ((baseDow - wkst + 7) % 7) * DAY;
      const list = (byday.length ? byday.map(b => b.dow) : [baseDow]).map(d => (d - wkst + 7) % 7).sort((a,b) => a-b);
      for(const idx of list){ if(done) break; const dm = wkBase + (k*interval*7 + idx)*DAY; if(passes(dm, false)) emit(dm); }
    } else if(freq === 'MONTHLY' || freq === 'YEARLY'){
      // MONTHLY or YEARLY: work out which month(s) to look at in this round, then which days inside them
      // (by day of the month, by weekday, or just the same day number as the start).
      let y, months;
      if(freq === 'MONTHLY'){
        const t = (st.m-1) + k*interval; y = st.y + Math.floor(t/12); months = [((t%12)+12)%12];
        if(bymonth.length && !bymonth.includes(months[0]+1)) continue;
      } else { y = st.y + k*interval; months = (bymonth.length ? bymonth : [st.m]).map(m => m-1).sort((a,b) => a-b); }
      for(const mo of months){
        if(done) break;
        const dim = new Date(Date.UTC(y,mo+1,0)).getUTCDate();
        let ds = [];
        if(bymonthday.length) ds = bymonthday.map(d => d > 0 ? d : dim + d + 1).filter(d => d >= 1 && d <= dim);
        else if(byday.length) byday.forEach(b => ds.push(...nthWeekday(y, mo, b.n, b.dow)));
        else if(st.d <= dim) ds = [st.d];
        ds = [...new Set(ds)].sort((a,b) => a-b);
        // BYSETPOS picks particular items from the list of days found above (for example -1 means "the last
        // one", which makes "the last weekday of the month" possible).
        if(r.BYSETPOS){
          const sp = r.BYSETPOS.split(',').map(Number);
          ds = [...new Set(sp.map(n => n > 0 ? ds[n-1] : ds[ds.length + n]).filter(Boolean))].sort((a,b) => a-b);
        }
        for(const d of ds){ if(done) break; emit(Date.UTC(y,mo,d)); }
      }
    } else break;
    // Stop early once we are well past the dates we care about.
    if(base + k*interval*DAY > to + 800*DAY && freq !== 'YEARLY') break;
  }
}

/* ---------- state ---------- */
// STATE. "State" means the information the page is currently remembering: who has been added, which
// settings are chosen, and so on. When the state changes, the page is redrawn to match.
// nextId hands out a new unique number to each person and calendar file.
let nextId = 1;
// The list of people. Each person is an object like {id, name, color, on, sources}, where sources
// are their calendar files and on says whether they are included.
const people = [];
// Gives today's date as text like "2026-11-18" in a given time zone (the 'en-CA' locale happens to
// write dates in exactly that order).
const todayStr = tz => new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
// S holds all the settings. tz = time zone, start = first date, days = how many days to look at,
// from/to = the daily window in minutes after midnight (540 = 9:00 AM, 1260 = 9:00 PM), dows = which weekdays
// are on (1) or off (0), dur = minimum free time in minutes, buf = gap around events in minutes,
// need = how many people must be free, allDay = count all-day events as busy, snap = round to the hour or
// half hour, titles = show event names, showAll = show every suggestion, selRun = the highlighted suggestion.
const S = {
  tz: LOCAL_TZ, start: todayStr(LOCAL_TZ), days: 14, from: 540, to: 1260,
  dows: [1,1,1,1,1,1,1], dur: 60, buf: 0, need: 'all', allDay: false, snap: true, titles: false, showAll: false, selRun: null
};
// calc remembers the most recent calculation of free time so other functions (such as hovering) can use it.
let calc = null;   // latest computation

/* ---------- formatting ---------- */
// FORMATTING. These helpers turn raw numbers into friendly text. The first two build "formatters":
// one for dates like "Wed, Nov 18" and one for times like "9:00 AM", both in the chosen time zone.
const fmtDayF = () => new Intl.DateTimeFormat('en-US',{timeZone:S.tz,weekday:'short',month:'short',day:'numeric'});
const fmtTimeF = () => new Intl.DateTimeFormat('en-US',{timeZone:S.tz,hour:'numeric',minute:'2-digit'});
// Turns minutes into words: 90 becomes "1h 30m". (The ? : pairs are a short if/else: "condition ? this : that".)
function fmtDur(min){ const h = Math.floor(min/60), m = min%60; return (h ? h+'h' : '') + (h && m ? ' ' : '') + (m ? m+'m' : ''); }
// Turns minutes after midnight into a clock time: 540 becomes "9 AM" and 810 becomes "1:30 PM".
function fmtClock(mm){ const h = Math.floor(mm/60)%24, m = mm%60; return (h%12||12) + (m ? ':'+String(m).padStart(2,'0') : '') + (h<12 ? ' AM' : ' PM'); }
// Gets the short name of the time zone (like MST). If the browser cannot, it falls back to the full name.
function tzAbbr(){ try{ return new Intl.DateTimeFormat('en-US',{timeZone:S.tz,timeZoneName:'short'}).formatToParts(new Date()).find(p => p.type==='timeZoneName').value; }catch(e){ return S.tz; } }
// Shows a short message at the bottom of the screen for about 3 seconds. It sets the text, adds the CSS
// class "show" to make it appear, and uses setTimeout (run this later, after N milliseconds) to remove the class.
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); }

/* ---------- adding calendars ---------- */
// ADDING CALENDARS. Guesses a person's name from the file name: "alex.ics" becomes "alex". Names that are
// too generic (like "calendar") or look like email addresses are tidied up.
function stemName(file, cal){
  let stem = (file||'').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim();
  if(stem.includes('@')) stem = stem.split('@')[0];
  if(!stem || /^(basic|calendar|cal|export|events|icalfeed|feed|download)$/i.test(stem)) stem = cal || stem || 'Person';
  if(stem.includes('@')) stem = stem.split('@')[0];
  return stem.slice(0,40);
}
// addSource adds one calendar's text to a person (or creates a new person). It first checks the safety
// limits and that the text really is a calendar, using throw to report problems.
function addSource(personId, name, fileName, text){
  if(text.length > MAX_BYTES) throw new Error('That file is larger than 10 MB.');
  if(!people.some(x => x.id === personId) && people.length >= MAX_PEOPLE) throw new Error('Up to '+MAX_PEOPLE+' people at a time.');
  const parsed = parseICS(text);
  if(!/BEGIN:VCALENDAR/i.test(text) && !parsed.total) throw new Error("That doesn't look like a calendar (.ics) file.");
  const have = people.reduce((n, q) => n + q.sources.reduce((m, src) => m + src.parsed.total, 0), 0);
  if(have + parsed.total > MAX_TOTAL_EVENTS) throw new Error('That would bring the total past '+MAX_TOTAL_EVENTS.toLocaleString()+' events across all calendars. Remove someone or export a shorter date range.');
  let p = people.find(x => x.id === personId);
  if(!p){
    p = {id: nextId++, name: name || stemName(fileName, parsed.calName), color: COLORS[(nextId-2) % COLORS.length], on: true, sources: []};
    people.push(p);
  }
  p.sources.push({id: nextId++, label: fileName || 'pasted', parsed});
  return {p, parsed};
}
// Reads the files you chose or dropped. "async" marks a function that waits for slow things; "await" pauses
// until a result is ready (reading a file takes a moment). Each file is read, added, and any problem is
// shown as a toast message. When at least one file worked, the page is redrawn.
async function readFiles(files, personId){
  let added = 0;
  for(const f of files){
    try{
      if(f.size > MAX_BYTES) throw new Error('larger than 10 MB, skipped');
      const text = await f.text();
      const r = addSource(personId, '', f.name, text);
      added++;
      if(personId == null) {} // each file becomes a person
    }catch(e){ toast(f.name + ': ' + e.message); }
  }
  if(added){ refresh(); }
}

/* ---------- computation ---------- */
// COMPUTING FREE TIME. This is the heart of the program. The plan:
//   1. Chop the chosen days into 15-minute "slots" (only inside the daily window).
//   2. For each person, list their busy periods and mark every slot free or busy.
//   3. Count how many people are free in each slot.
//   4. Join neighboring slots with the same free people into longer stretches ("runs"), keeping the long enough ones.
function compute(){
  // Reset the work budget for this calculation.
  BUDGET.n = WORK_BUDGET; BUDGET.hit = false;
  // inc = the people who are switched on. filter() keeps only the list items for which the test is true.
  const inc = people.filter(p => p.on);
  // Step 1: the slots. Split the start date "2026-11-18" into year, month and day numbers, then loop through the days.
  const [y,m,d] = S.start.split('-').map(Number);
  const slots = [], days = [];
  for(let i = 0; i < S.days; i++){
    const dt = new Date(Date.UTC(y, m-1, d+i)), dow = dt.getUTCDay();
    if(!S.dows[dow]) continue;
    const Y = dt.getUTCFullYear(), M = dt.getUTCMonth()+1, D = dt.getUTCDate();
    const day = {Y,M,D,dow, first: slots.length};
    for(let mm = S.from; mm < S.to; mm += 15)
      slots.push({ts: zonedToUtc(Y,M,D,Math.floor(mm/60),mm%60,0,S.tz), mm, day: days.length});
    day.last = slots.length;
    days.push(day);
  }
  // res collects the results. If there are no slots or no people, return early with nothing in it.
  const res = {inc, slots, days, free: [], ivs: [], runs: [], need: 0};
  if(!slots.length || !inc.length) return res;
  // The time range we care about, with a day of padding on each side.
  const from = slots[0].ts - DAY, to = slots[slots.length-1].ts + DAY;
  // Step 2: for each included person, work out when they are busy. forEach runs the steps once per item.
  inc.forEach(p => {
    let list = [];
    p.sources.forEach(s => s.parsed.events.forEach(ev => expandEvent(ev, from - 3*DAY, to + 3*DAY, list)));
    // Remove all-day events unless the "all-day events are busy" box is ticked.
    list = list.filter(x => S.allDay || !x[3]);
    // If the user asked for a gap around events, stretch each busy period earlier and later by that amount.
    if(S.buf) list = list.map(x => x[3] ? x : [x[0]-S.buf*MIN, x[1]+S.buf*MIN, x[2], x[3]]);
    list.sort((a,b) => a[0]-b[0]);
    res.ivs.push(list);
    // Merge busy periods that overlap into one bigger period, so each moment is counted once.
    const merged = [];
    for(const x of list){
      const last = merged[merged.length-1];
      if(last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else merged.push([x[0], x[1]]);
    }
    // For every slot, record whether this person is free (true) or busy (false). Because both lists are in time
    // order, j only ever moves forward, which keeps this fast.
    const flags = new Array(slots.length); let j = 0;
    for(let i = 0; i < slots.length; i++){
      const ts = slots[i].ts;
      while(j < merged.length && merged[j][1] <= ts) j++;
      flags[i] = !(j < merged.length && merged[j][0] < ts + 15*MIN);
    }
    res.free.push(flags);
  });
  // Step 3: count how many people are free in each slot, and work out how many people are required
  // (everyone, or a smaller number if the user chose "at least N").
  const N = inc.length;
  res.need = S.need === 'all' ? N : Math.min(+S.need || N, N);
  res.count = slots.map((_, i) => res.free.reduce((n, f) => n + (f[i] ? 1 : 0), 0));
  // keyOf makes a string like "1011" showing exactly who is free in a slot (1 = free). Two neighboring slots can
  // only be joined into one stretch when they have the same key, so a stretch always has the same people.
  const keyOf = i => res.free.map(f => f[i] ? 1 : 0).join('');
  // Step 4: go day by day, and find stretches of consecutive slots where enough people are free.
  for(const day of days){
    let a = -1, key = '';
    // close finishes a stretch that began at slot a and ended at slot b. If "start and end on the hour or half
    // hour" is on, trim the edges. If what is left is at least as long as the minimum, record it.
    const close = b => {
      let ia = a, ib = b;
      // Trim the start until it begins on :00 or :30, and the end until it finishes on :00 or :30.
      if(S.snap){
        while(ia <= ib && slots[ia].mm % 30 !== 0) ia++;
        while(ib >= ia && slots[ib].mm % 30 !== 15) ib--;
      }
      const dur = (ib - ia + 1) * 15;
      if(ia <= ib && dur >= S.dur){
        const who = []; for(let k = 0; k < N; k++) if(res.free[k][ia]) who.push(k);
        res.runs.push({a:ia, b:ib, start:slots[ia].ts, end:slots[ib].ts + 15*MIN, dur, who, count:who.length});
      }
    };
    // Walk through the day's slots. Start a stretch when enough people are free, end it when that stops or the
    // group of free people changes.
    for(let i = day.first; i < day.last; i++){
      const ok = res.count[i] >= res.need && res.count[i] > 0;
      const k = ok ? keyOf(i) : '';
      if(a >= 0 && k !== key){ close(i-1); a = -1; }
      if(ok && a < 0){ a = i; key = k; }
    }
    if(a >= 0) close(day.last-1);
  }
  // Sort the stretches: most people first, then either longest first or soonest first, depending on the
  // user's choice. (A sort function returns a negative, zero or positive number to say which item goes first.)
  res.runs.sort((x,y) => (y.count - x.count) || (S.sort === 'long' ? y.dur - x.dur : 0) || x.start - y.start);
  return res;
}

/* ---------- rendering ---------- */
// DRAWING THE PAGE. "Rendering" means turning data into what you see. renderPeople rebuilds the list of
// people on the left. It builds a long piece of HTML text with a "template literal": text between backticks
// (`) that can embed values using ${...}. That HTML is then put on the page with innerHTML.
// Every name goes through esc() first, for safety.
function renderPeople(){
  $('#people').innerHTML = people.map(p => `
    <li class="person ${p.on?'':'off'}" data-id="${p.id}">
      <div class="p-head">
        <input class="chk" type="checkbox" data-act="toggle" ${p.on?'checked':''} aria-label="Include ${esc(p.name)}">
        <span class="dot" style="background:${p.color}"></span>
        <input type="text" data-act="rename" value="${esc(p.name)}" aria-label="Name">
        <button class="btn ghost icon-btn" data-act="remove" aria-label="Remove ${esc(p.name)}" title="Remove person">✕</button>
      </div>
      ${p.sources.map(s => `<div class="src"><span title="${esc(s.label)}">${esc(s.label)} · ${s.parsed.total} event${s.parsed.total===1?'':'s'}</span><button class="btn ghost icon-btn" style="width:28px;height:28px" data-act="rmsrc" data-sid="${s.id}" aria-label="Remove ${esc(s.label)}">✕</button></div>`).join('')}
      <div class="p-actions">
        <button class="btn small" data-act="addfile">+ File</button>
        <button class="btn small" data-act="addlink">+ Link</button>
      </div>
    </li>`).join('');
  // Show the "Clear all" button only when there is at least one person (toggle adds or removes a class).
  $('#btnClear').classList.toggle('hidden', !people.length);
  // Rebuild the "Who must be free" dropdown: "Everyone", then "At least N of M" for each smaller N.
  const inc = people.filter(p => p.on).length;
  const opts = ['<option value="all">Everyone ('+inc+')</option>'];
  for(let n = inc-1; n >= 2; n--) opts.push(`<option value="${n}">At least ${n} of ${inc}</option>`);
  const sel = $('#sNeed'); sel.innerHTML = opts.join('');
  if(![...sel.options].some(o => o.value === String(S.need))) S.need = 'all';
  sel.value = String(S.need);
}

// Draws the little colored dots for the people who are free in a suggestion.
function pips(idxs, inc){ return `<span class="pips">${idxs.map(i => `<span class="pip" style="background:${inc[i].color}" title="${esc(inc[i].name)}"></span>`).join('')}</span>`; }

// renderResults draws the whole right-hand side: the headline, the suggestions and the grid.
// It runs again every time something changes.
function renderResults(){
  saveSettings();   // remember the current settings every time the page redraws
  // el is the results area on the page.
  const el = $('#results');
  const inc = people.filter(p => p.on);
  // If nobody has been added yet, show the welcome message and stop (return leaves the function).
  if(!people.length){
    el.innerHTML = `<section class="card empty">
      <h3>Find the time that works for everyone.</h3>
      <ol><li>Export each person's calendar as an .ics file.</li><li>Drop the files on the left, one per person.</li><li>Overlap shows the stretches when everyone is free.</li></ol>
      <button class="btn primary" data-act="demo" type="button">Try it with sample calendars</button>
    </section>`;
    return;
  }
  // If people exist but all are switched off, show a hint instead.
  if(!inc.length){ el.innerHTML = `<section class="card"><p>Turn on at least one person to see their free time.</p></section>`; return; }
  // Do the calculation, then keep a short name (c) for the results. If no days are selected, say so.
  calc = compute();
  const c = calc;
  if(!c.slots.length){ el.innerHTML = `<section class="card"><p>No days selected, or the daily window is empty. Adjust "When to look".</p></section>`; return; }
  // Prepare the formatters and a few numbers used in the headline.
  const dayF = fmtDayF(), timeF = fmtTimeF();
  const total = c.runs.length;
  const allCount = c.runs.filter(r => r.count === inc.length).length;
  const first = c.slots[0].ts, last = c.slots[c.slots.length-1].ts;
  // The headline text: how many times were found, or a message when there are none.
  const big = total
    ? `${total} time${total===1?'':'s'} to meet`
    : (S.need==='all' ? 'No shared time yet' : 'No matching time');
  // Build any notices: warnings about repeat rules we could not read or work we cut short, and helpful
  // advice when no time was found (such as "Try 3 of 4").
  let notice = '';
  const unsup = inc.reduce((n, q) => n + q.sources.reduce((m, src) => m + src.parsed.unsupported, 0), 0);
  if(unsup) notice += `<div class="notice"><span>${unsup} repeating event${unsup===1?' uses a rule':'s use rules'} this page can't read. Only the first occurrence is counted, so some busy time may be missing.</span></div>`;
  if(BUDGET.hit) notice += `<div class="notice"><span>One of the calendars has very long repeating events, so some of them were cut short. Results may be incomplete.</span></div>`;
  // Choose the right advice message depending on what happened.
  if(!total){
    const cur = c.need;
    if(cur > 2 && inc.length > 2) notice = `<div class="notice"><span>Nobody is free for ${fmtDur(S.dur)} across all ${cur} people.</span><button class="btn small" data-act="relax" data-n="${cur-1}">Try ${cur-1} of ${inc.length}</button></div>`;
    else notice = `<div class="notice"><span>No ${fmtDur(S.dur)} window fits. Try a shorter length, more days, or a wider daily window.</span></div>`;
  } else if(S.need !== 'all' && allCount === 0){
    notice = `<div class="notice"><span>Nobody found a time for all ${inc.length}. These are the best partial matches.</span></div>`;
  }
  // Only the first 8 suggestions are shown unless "Show all" was clicked (slice(0, 8) takes the first eight).
  const shown = S.showAll ? c.runs : c.runs.slice(0, 8);
  // Turn each suggestion into a block of HTML: the day and time, the free people, and Copy and Invite buttons.
  // map() builds a new list by running the steps on every item, and join('') glues the pieces into one text.
  const sugs = shown.map((r, i) => {
    const idx = i;
    return `<div class="sug ${S.selRun===r.a?'sel':''}" data-act="pick" data-a="${r.a}" data-b="${r.b}" role="button" tabindex="0" aria-label="Highlight ${dayF.format(r.start)}">
      <div>
        <div class="when">${dayF.format(r.start)} · ${timeF.format(r.start)} – ${timeF.format(r.end)}</div>
        <div class="meta"><span>${fmtDur(r.dur)} free</span>${pips(r.who, inc)}<span>${r.count===inc.length ? 'Everyone' : r.count+' of '+inc.length+': '+r.who.map(k => esc(inc[k].name)).join(', ')}</span></div>
      </div>
      <div class="sug-actions">
        <button class="btn small" data-act="copy" data-i="${idx}">Copy</button>
        <button class="btn small primary" data-act="ics" data-i="${idx}" title="Download a calendar invite for the first ${fmtDur(S.dur)}">Invite</button>
      </div>
    </div>`;
  }).join('');
  // A "Show all" / "Show fewer" button, only when there are more than 8 suggestions.
  const more = total > 8 ? `<button class="btn" style="margin-top:12px" data-act="more">${S.showAll ? 'Show fewer' : 'Show all '+total}</button>` : '';

  // heatmap
  // Now build the grid (heatmap): one column per day and one row per 15 minutes.
  const nd = c.days.length;
  const hours = [];
  // Start the grid's HTML. The style attribute sets how many columns it has.
  let heat = `<div class="heat" id="heat" style="grid-template-columns:52px repeat(${nd},minmax(58px,1fr))"><div class="hh" style="left:0;z-index:3"></div>`;
  // The header row: one label per day.
  c.days.forEach(d => {
    const ts = zonedToUtc(d.Y,d.M,d.D,12,0,0,S.tz);
    heat += `<div class="hh"><b>${DOW[d.dow]}</b><span>${new Intl.DateTimeFormat('en-US',{timeZone:S.tz,month:'short',day:'numeric'}).format(ts)}</span></div>`;
  });
  // The rows: for each 15-minute step, add a time label and one cell per day. Each cell's --f value
  // (0 to 1) is the share of people who are free, which the CSS turns into a shade of green.
  const rows = (S.to - S.from) / 15;
  const N = inc.length;
  for(let r = 0; r < rows; r++){
    const mm = S.from + r*15;
    heat += `<div class="tl">${mm%60===0 ? fmtClock(mm) : ''}</div>`;
    c.days.forEach((d, di) => {
      const si = d.first + r, cnt = c.count[si], f = cnt / N;
      heat += `<div class="cell ${mm%60===0?'hr':''} ${cnt>=c.need&&cnt>0?'ok':''} ${cnt===0?'none':''}" data-s="${si}" style="--f:${f.toFixed(3)}"></div>`;
    });
  }
  heat += '</div>';
  // Put everything together and place it on the page in one go.
  el.innerHTML = `
    <section class="card">
      <div class="summary">
        <div><div class="big">${big}</div>
        <div class="sub">${N} ${N===1?'person':'people'} · ${new Intl.DateTimeFormat('en-US',{timeZone:S.tz,month:'short',day:'numeric'}).format(first)} – ${new Intl.DateTimeFormat('en-US',{timeZone:S.tz,month:'short',day:'numeric'}).format(last)} · ${fmtClock(S.from)}–${fmtClock(S.to)} ${esc(tzAbbr())}</div></div>
        <label class="f" style="min-width:150px">Order<select id="sSort"><option value="soon" ${S.sort!=='long'?'selected':''}>Soonest first</option><option value="long" ${S.sort==='long'?'selected':''}>Longest first</option></select></label>
      </div>
      ${notice}
      <div class="sugs">${sugs}</div>${more}
    </section>
    <section class="card">
      <div class="heat-head"><h2 style="margin:0">Every day at a glance</h2>
        <div class="legend"><span>Busy</span><i></i><span>All free</span></div></div>
      <div class="heat-scroll">${heat}</div>
      <div class="readout" id="readout">Hover or tap a time to see who's free.</div>
    </section>`;
  // Finally, highlight the selected suggestion (if any) in the grid.
  applySel();
}

// applySel highlights the selected suggestion: it clears old highlights, then marks the chosen cells
// (with extra classes on the first and last so the CSS can draw one box around them).
function applySel(){
  document.querySelectorAll('.cell.sel').forEach(x => x.classList.remove('sel','selt','selb'));
  document.querySelectorAll('.sug').forEach(x => x.classList.toggle('sel', S.selRun !== null && +x.dataset.a === S.selRun));
  if(S.selRun === null || !calc) return;
  const r = calc.runs.find(x => x.a === S.selRun); if(!r) return;
  for(let i = r.a; i <= r.b; i++){ const c = document.querySelector(`.cell[data-s="${i}"]`); if(c){ c.classList.add('sel'); if(i === r.a) c.classList.add('selt'); if(i === r.b) c.classList.add('selb'); } }
}

// showReadout fills the text box under the grid with who is free and who is busy at the time you
// pointed at. Event names are only shown if "Show event names" is ticked.
function showReadout(si){
  const c = calc, ro = $('#readout'); if(!c || !ro) return;
  const slot = c.slots[si]; if(!slot) return;
  const free = [], busy = [];
  c.inc.forEach((p, k) => {
    if(c.free[k][si]) free.push(p);
    else {
      const ev = c.ivs[k].find(x => x[0] < slot.ts + 15*MIN && x[1] > slot.ts);
      busy.push({p, title: ev ? ev[2] : 'busy'});
    }
  });
  const who = (p, extra) => `<span class="who"><span class="pip" style="background:${p.color}"></span>${esc(p.name)}${extra ? ' <span style="color:var(--muted)">('+esc(extra)+')</span>' : ''}</span>`;
  ro.innerHTML = `<b>${fmtDayF().format(slot.ts)}, ${fmtTimeF().format(slot.ts)}</b><br>`
    + `Free: ${free.length ? free.map(p => who(p)).join('') : '<span style="color:var(--muted)">nobody</span>'}`
    + (busy.length ? `<br>Busy: ${busy.map(b => who(b.p, S.titles ? b.title : '')).join('')}` : '');
}

/* ---------- actions on suggestions ---------- */
// ACTIONS ON SUGGESTIONS. runText builds the sentence copied by the Copy button, like
// "Free Wed, Nov 18, 2:00 PM - 4:00 PM MST (2h): Alex, Sam".
function runText(r){
  const inc = calc.inc;
  return `Free ${fmtDayF().format(r.start)}, ${fmtTimeF().format(r.start)} – ${fmtTimeF().format(r.end)} ${tzAbbr()} (${fmtDur(r.dur)}): ` + r.who.map(k => inc[k].name).join(', ');
}
// Turns a timestamp into the compact UTC date-time format used inside .ics files (like 20261118T160000Z).
function icsStamp(ts){ return new Date(ts).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''); }
// Creates a small .ics calendar file for the suggested time and downloads it. A "Blob" is a file made in
// memory; URL.createObjectURL gives it a temporary address; an invisible link is created and "clicked"
// to start the download; then the temporary address is cleaned up.
function downloadInvite(r){
  const end = r.start + Math.min(r.end - r.start, S.dur*MIN);
  const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Overlap//EN','BEGIN:VEVENT',
    'UID:overlap-'+r.start+'-'+Math.random().toString(36).slice(2)+'@local','DTSTAMP:'+icsStamp(Date.now()),
    'DTSTART:'+icsStamp(r.start),'DTEND:'+icsStamp(end),'SUMMARY:Hang out','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], {type:'text/calendar'}));
  a.download = 'hangout.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Invite downloaded. Open it to add it to your calendar.');
}
// Copies text to the clipboard. If the modern way is blocked, it falls back to an older trick: put the text in
// a hidden box, select it, and run the browser's copy command.
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); toast('Copied'); }
  catch(e){ const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); toast('Copied'); }catch(_){ toast('Copy failed'); } ta.remove(); }
}

/* ---------- sample data ---------- */
// SAMPLE DATA. This builds four pretend calendars (as .ics text) so you can try the site without any files.
// Dates are created relative to today so the examples never go out of date.
function demoCalendars(){
  const today = new Date();
  // ymd turns "today plus some days" into the compact date text used in .ics files (like 20261118).
  const ymd = (off) => { const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()+off); return t.getFullYear()+String(t.getMonth()+1).padStart(2,'0')+String(t.getDate()).padStart(2,'0'); };
  // ev builds the text of one timed event (with an optional repeat rule); allDay builds an all-day event;
  // wrap puts events inside a calendar. The \r\n sequences are line breaks the .ics format requires.
  const ev = (title, day, s, e, tz, rule) => `BEGIN:VEVENT\r\nUID:${Math.random().toString(36).slice(2)}\r\nSUMMARY:${title}\r\nDTSTART;TZID=${tz}:${ymd(day)}T${s}00\r\nDTEND;TZID=${tz}:${ymd(day)}T${e}00\r\n${rule?'RRULE:'+rule+'\r\n':''}END:VEVENT\r\n`;
  const allDay = (title, day) => `BEGIN:VEVENT\r\nUID:${Math.random().toString(36).slice(2)}\r\nSUMMARY:${title}\r\nDTSTART;VALUE=DATE:${ymd(day)}\r\nDTEND;VALUE=DATE:${ymd(day+1)}\r\nEND:VEVENT\r\n`;
  const wrap = (name, body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:${name}\r\n${body}END:VCALENDAR\r\n`;
  // WK is a repeat rule meaning "every weekday"; L is this computer's time zone.
  const WK = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', L = LOCAL_TZ;
  // The four sample people, each a [name, calendar text] pair.
  return [
    ['Alex', wrap('Alex', ev('Standup',0,'0930','1000',L,WK)+ev('Design review',0,'1300','1500',L,'FREQ=WEEKLY;BYDAY=TU,TH')+ev('Gym',0,'1730','1830',L,'FREQ=WEEKLY;BYDAY=MO,WE')+ev('Dentist',3,'1100','1200',L)+ev('Dinner with parents',5,'1800','2100',L)+allDay('Birthday',4))],
    ['Sam', wrap('Sam', ev('Class',0,'1000','1200',L,'FREQ=WEEKLY;BYDAY=MO,WE,FR')+ev('Work',0,'1230','1630',L,WK)+ev('Band practice',0,'1900','2100',L,'FREQ=WEEKLY;BYDAY=TU')+ev('Soccer',6,'0900','1100',L)+ev('Flight',9,'0800','1400',L))],
    ['Priya', wrap('Priya', ev('Team block',0,'0900','1200','America/Los_Angeles',WK)+ev('Customer calls',0,'1300','1600','America/Los_Angeles','FREQ=WEEKLY;BYDAY=TU,TH')+ev('Yoga',0,'1000','1100','America/Los_Angeles','FREQ=WEEKLY;BYDAY=SA')+ev('Concert',2,'1830','2230','America/Los_Angeles'))],
    ['Jordan', wrap('Jordan', ev('Shift',0,'0800','1600','America/New_York','FREQ=WEEKLY;BYDAY=MO,TU,TH')+ev('Book club',0,'1900','2100','America/New_York','FREQ=WEEKLY;BYDAY=WE')+ev('Family visit',7,'1000','1800','America/New_York'))]
  ];
}

/* ---------- refresh ---------- */
// refresh redraws both the people list and the results. It is called whenever the data changes.
function refresh(){ renderPeople(); renderResults(); }

/* ---------- wiring ---------- */
// WIRING THE PAGE TOGETHER. buildSelectors fills the dropdowns that the HTML left empty (times, lengths,
// day buttons and time zones) and shows the current settings in the controls.
function buildSelectors(){
  // A helper that builds the <option> tags for a time dropdown, every 30 minutes.
  const opts = (from, to) => { const o = []; for(let mm = from; mm <= to; mm += 30) o.push(`<option value="${mm}">${fmtClock(mm)}</option>`); return o.join(''); };
  $('#sFrom').innerHTML = opts(0, 1380); $('#sTo').innerHTML = opts(30, 1440).replace('>12 AM<', '>12 AM (midnight)<');
  $('#sDur').innerHTML = [30,45,60,90,120,180,240,360].map(n => `<option value="${n}">${fmtDur(n)}</option>`).join('');
  $('#dows').innerHTML = [1,2,3,4,5,6,0].map(d => `<label><input type="checkbox" data-dow="${d}" checked aria-label="${DOW[d]}"><span>${DOW[d]}</span></label>`).join('');
  // Build the time zone list from the browser's built-in list (inside try/catch in case the browser lacks it).
  let zones = [];
  try{ zones = Intl.supportedValuesOf('timeZone'); }catch(e){}
  if(!zones.includes(LOCAL_TZ)) zones.unshift(LOCAL_TZ);
  if(!zones.includes('UTC')) zones.push('UTC');
  $('#sTz').innerHTML = zones.map(z => `<option value="${esc(z)}">${esc(z.replace(/_/g,' '))}${z===LOCAL_TZ?' (yours)':''}</option>`).join('');
  // Set each control to match the current settings.
  $('#sStart').value = S.start; $('#sDays').value = S.days; $('#sFrom').value = S.from; $('#sTo').value = S.to; $('#sDur').value = S.dur; $('#sTz').value = S.tz;
  // show the remembered settings in the controls
  $('#sBuf').value = S.buf; $('#oAllDay').checked = S.allDay; $('#oSnap').checked = S.snap; $('#oTitles').checked = S.titles;
  document.querySelectorAll('[data-dow]').forEach(x => x.checked = !!S.dows[+x.dataset.dow]);
}
// syncSettings does the opposite: it reads every control and stores the values in S, then redraws.
// It also makes sure the "Latest" time is always later than the "Earliest" time.
function syncSettings(){
  S.start = $('#sStart').value || todayStr(S.tz);
  S.days = +$('#sDays').value; S.from = +$('#sFrom').value; S.to = +$('#sTo').value;
  if(S.to <= S.from){ S.to = Math.min(1440, S.from + 30); $('#sTo').value = S.to; }
  S.dur = +$('#sDur').value; S.buf = +$('#sBuf').value; S.need = $('#sNeed').value; S.tz = $('#sTz').value;
  S.allDay = $('#oAllDay').checked; S.snap = $('#oSnap').checked; S.titles = $('#oTitles').checked;
  document.querySelectorAll('[data-dow]').forEach(x => S.dows[+x.dataset.dow] = x.checked ? 1 : 0);
  S.selRun = null;
  renderResults();
}
// EVENTS. An "event" is something that happens on the page, like a click or a change to a dropdown.
// addEventListener says: "when this event happens, run this function". The function you give it is called a
// "callback". Here, every settings control runs syncSettings when its value changes.
['#sStart','#sDays','#sFrom','#sTo','#sDur','#sBuf','#sNeed','#sTz','#oAllDay','#oSnap','#oTitles'].forEach(id => $(id).addEventListener('change', syncSettings));
// The day buttons: one listener on their container hears changes from all seven (events "bubble" upward).
$('#dows').addEventListener('change', syncSettings);

/* dialog for link / paste */
// THE POP-UP. dlgMode remembers whether the pop-up is for a link or pasted text; dlgConfirmed remembers which
// website the user already approved fetching from.
let dlgMode = 'link', dlgTarget = null, dlgConfirmed = null;
// Opens the pop-up: sets its title, shows only the fields that are needed, fills the "whose calendar"
// dropdown, clears old text, and calls showModal(), the built-in command that displays a dialog.
function openDlg(mode, personId){
  dlgMode = mode; dlgTarget = personId || null;
  $('#dlgTitle').textContent = mode === 'link' ? 'Add a calendar link' : 'Paste calendar text';
  $('#dlgUrlWrap').classList.toggle('hidden', mode !== 'link');
  $('#dlgTextWrap').classList.toggle('hidden', mode !== 'paste');
  $('#dlgPerson').innerHTML = '<option value="">New person</option>' + people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#dlgPerson').value = personId ? String(personId) : '';
  $('#dlgName').value = ''; $('#dlgUrl').value = ''; $('#dlgText').value = ''; $('#dlgErr').textContent = '';
  $('#dlgNameWrap').classList.toggle('hidden', !!personId);
  dlgConfirmed = null; $('#dlgNote').textContent = '';
  $('#dlgOk').disabled = false; $('#dlgOk').textContent = 'Add';
  $('#dlg').showModal();
}
// When an existing person is chosen, hide the "Name" box (it is only needed for a new person).
$('#dlgPerson').addEventListener('change', e => $('#dlgNameWrap').classList.toggle('hidden', !!e.target.value));
// The Cancel button closes the pop-up.
$('#dlgCancel').addEventListener('click', () => $('#dlg').close());
// Whenever the pop-up closes (by any route, even the Esc key), wipe what was typed or pasted so no
// calendar text lingers on the page.
$('#dlg').addEventListener('close', () => { $('#dlgText').value = ''; $('#dlgUrl').value = ''; $('#dlgName').value = ''; $('#dlgErr').textContent = ''; $('#dlgNote').textContent = ''; dlgConfirmed = null; });
// If the link is edited, the earlier confirmation no longer applies, so reset it.
$('#dlgUrl').addEventListener('input', () => { dlgConfirmed = null; $('#dlgNote').textContent = ''; $('#dlgOk').textContent = 'Add'; });
// When the pop-up's form is submitted: read the person and name, then fetch the link or read the pasted text.
// (async because fetching from the internet takes time. e is the event object describing what happened.)
$('#dlgForm').addEventListener('submit', async e => {
  // Stop the browser's normal form behavior; we handle everything ourselves.
  e.preventDefault();
  const pid = $('#dlgPerson').value ? +$('#dlgPerson').value : null;
  const name = $('#dlgName').value.trim();
  const err = $('#dlgErr'); err.textContent = '';
  // Everything below is in a try block: if anything throws an error, the catch at the end shows the message in
  // the pop-up instead of crashing.
  try{
    let text, label;
    if(dlgMode === 'link'){
      let url = $('#dlgUrl').value.trim();
      if(!url) throw new Error('Paste a calendar link first.');
      // A "webcal://" address is just a calendar link; we change it to https:// (secure web address) and refuse
      // any other kind.
      url = url.replace(/^webcal:/i, 'https:');
      if(!/^https:\/\//i.test(url)) throw new Error('Only https:// and webcal:// links are allowed.');
      // Extract the website's name (the host) from the link, and report an error if the link is not valid.
      let host; try{ host = new URL(url).hostname; }catch(_){ throw new Error('That link is not a valid web address.'); }
      // PRIVACY CHECK. The first time you submit a link, we do not fetch it. We tell you which site will be
      // contacted (and that it can see your IP address, the number that identifies your connection) and ask you to
      // click again. Addresses on your own network get an extra warning.
      if(dlgConfirmed !== host){
        dlgConfirmed = host;
        const local = /^(localhost|.*\.local|10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host);
        $('#dlgNote').textContent = 'This will contact ' + host + ' from your browser, and that site will see your IP address.' + (local ? ' It looks like an address on your own network.' : '') + ' Click again to continue.';
        $('#dlgOk').textContent = 'Fetch from ' + host;
        return;
      }
      // Second click: show "Fetching" and disable the button so it cannot be pressed twice.
      $('#dlgOk').disabled = true; $('#dlgOk').textContent = 'Fetching…';
      // fetch downloads the calendar from the internet. An AbortController cancels the request after 15 seconds,
      // no cookies are sent (credentials: 'omit'), and no referrer is sent. If anything fails, show a friendly
      // explanation: many calendar hosts block downloads made this way, and the fix is to download the file manually.
      try{ const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 15000); const r = await fetch(url, {signal: ac.signal, credentials:'omit', referrerPolicy:'no-referrer', redirect:'follow'}); clearTimeout(to); if(!r.ok) throw new Error('HTTP '+r.status); text = await r.text(); }
      catch(ex){ throw new Error("Couldn't read that link from the browser (most calendar hosts block this). Download the .ics file and drop it in instead."); }
      // Make a short label from the address for the list of files.
      label = url.replace(/^https?:\/\//,'').slice(0,40);
    } else {
      // The pasted-text option: read the box and complain if it is empty.
      text = $('#dlgText').value; if(!text.trim()) throw new Error('Paste the contents of an .ics file first.');
      label = 'pasted text';
    }
    // Add the calendar (this throws an error if the text is not a calendar or breaks a safety limit), close
    // the pop-up and redraw.
    addSource(pid, name, label, text);
    $('#dlg').close(); refresh();
  }catch(ex){ err.textContent = ex.message; $('#dlgOk').disabled = false; $('#dlgOk').textContent = 'Add'; }
});

/* buttons & delegation */
// BUTTONS AND CLICKS. "Choose files" opens the hidden file picker; "Add link" and "Paste" open the pop-up.
$('#btnFiles').addEventListener('click', () => $('#fileIn').click());
$('#btnLink').addEventListener('click', () => openDlg('link'));
$('#btnPaste').addEventListener('click', () => openDlg('paste'));
// When files are chosen, read them (each becomes a new person). The "..." (spread) copies the file list into a normal
// array. Resetting the value lets the same file be chosen again later.
$('#fileIn').addEventListener('change', e => { readFiles([...e.target.files], null); e.target.value = ''; });
// Remember which person the second file picker is adding to.
let pendingPerson = null;
$('#fileInPerson').addEventListener('change', e => { readFiles([...e.target.files], pendingPerson); e.target.value = ''; });
// Clear all: empty the list (setting its length to 0) and redraw.
$('#btnClear').addEventListener('click', () => { people.length = 0; S.selRun = null; refresh(); });
// Replace everything with the four sample calendars. The [name, text] pairs are unpacked directly in the
// function's parameters (a feature called destructuring).
function loadDemo(){
  people.length = 0; nextId = 1;
  demoCalendars().forEach(([name, text]) => addSource(null, name, name.toLowerCase()+'.ics', text));
  S.selRun = null; refresh();
}
$('#btnDemo').addEventListener('click', loadDemo);

// EVENT DELEGATION. The list of people is rebuilt often, so instead of attaching a listener to every button,
// one listener on the whole list asks "which button inside me was clicked?" (closest finds the nearest
// matching parent). The data-act attribute on each button says what it does (remove, add a file, ...).
$('#people').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if(!b) return;
  const li = b.closest('.person'), id = +li.dataset.id, p = people.find(x => x.id === id);
  const act = b.dataset.act;
  if(act === 'remove'){ people.splice(people.indexOf(p), 1); refresh(); }
  else if(act === 'rmsrc'){ p.sources = p.sources.filter(s => s.id !== +b.dataset.sid); if(!p.sources.length) people.splice(people.indexOf(p), 1); refresh(); }
  else if(act === 'addfile'){ pendingPerson = id; $('#fileInPerson').click(); }
  else if(act === 'addlink'){ openDlg('link', id); }
});
// Checkbox and name edits: switch a person on or off, or rename them.
$('#people').addEventListener('change', e => {
  const li = e.target.closest('.person'); if(!li) return;
  const p = people.find(x => x.id === +li.dataset.id);
  if(e.target.dataset.act === 'toggle'){ p.on = e.target.checked; S.selRun = null; refresh(); }
  else if(e.target.dataset.act === 'rename'){ p.name = e.target.value.trim() || 'Person'; renderResults(); }
});

// The same delegation idea for the results area: Copy, Invite, "Show all", "Try N of M", the sample button,
// suggestion selection, and clicking a grid cell (to see its details on touch screens).
$('#results').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if(!b){ const c = e.target.closest('.cell'); if(c) showReadout(+c.dataset.s); return; }
  const act = b.dataset.act;
  if(act === 'demo') loadDemo();
  else if(act === 'more'){ S.showAll = !S.showAll; renderResults(); }
  else if(act === 'relax'){ S.need = b.dataset.n; $('#sNeed').value = S.need; renderResults(); }
  else if(act === 'copy'){ e.stopPropagation(); copyText(runText(calc.runs[+b.dataset.i])); }
  else if(act === 'ics'){ e.stopPropagation(); downloadInvite(calc.runs[+b.dataset.i]); }
  else if(act === 'pick'){
    S.selRun = (S.selRun === +b.dataset.a) ? null : +b.dataset.a; applySel();
    const cell = document.querySelector(`.cell[data-s="${b.dataset.a}"]`);
    if(cell && S.selRun !== null){ const sc = cell.closest('.heat-scroll'); const r = cell.getBoundingClientRect(), rs = sc.getBoundingClientRect(); if(r.top < rs.top || r.bottom > rs.bottom) sc.scrollTop += r.top - rs.top - 60; showReadout(+b.dataset.a); }
  }
});
// Keyboard support: pressing Enter or Space on a suggestion acts like clicking it.
$('#results').addEventListener('keydown', e => {
  if((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('sug')){ e.preventDefault(); e.target.click(); }
});
// Changing the sort order redraws the results.
$('#results').addEventListener('change', e => { if(e.target.id === 'sSort'){ S.sort = e.target.value; renderResults(); } });
// Pointing at a grid cell shows who is free or busy then.
$('#results').addEventListener('mouseover', e => { const c = e.target.closest('.cell'); if(c) showReadout(+c.dataset.s); });

/* drag and drop anywhere */
// DRAG AND DROP. dragN counts how deep the pointer is inside the page while dragging, so the highlight
// switches off only when the file really leaves the page.
let dragN = 0;
// window is the whole browser window. When a file is dragged in, add the "dragging" class (styles.css
// highlights the drop zone); remove it when the file leaves.
window.addEventListener('dragenter', e => { if(e.dataTransfer && [...e.dataTransfer.types].includes('Files')){ dragN++; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN-1); if(!dragN) document.body.classList.remove('dragging'); });
// Browsers refuse drops unless dragover is cancelled, so cancel it.
window.addEventListener('dragover', e => e.preventDefault());
// When a file is dropped, cancel the browser's default (which would open the file) and read it instead.
window.addEventListener('drop', e => {
  e.preventDefault(); dragN = 0; document.body.classList.remove('dragging');
  const files = [...(e.dataTransfer.files || [])]; if(files.length) readFiles(files, null);
});

/* ---------- Saved settings (localStorage) ----------
   localStorage keeps small pieces of text in the browser, even after you close the tab.
   Here it remembers your "When to look" choices. Calendars are NOT saved. */
const SAVE_KEY = 'overlap-settings';
const SAVED_FIELDS = ['tz','days','from','to','dows','dur','buf','allDay','snap','titles','sort'];

// Saves the chosen settings. JSON.stringify turns the settings object into text, because localStorage can
// only hold text. JSON is a simple text format for data. This runs every time the page is redrawn.
function saveSettings(){
  try{
    const out = {};
    SAVED_FIELDS.forEach(k => out[k] = S[k]);
    localStorage.setItem(SAVE_KEY, JSON.stringify(out));   // objects must become text first
  }catch(e){}   // storage can be blocked (private mode); the site still works without it
}

// Reads the saved settings back when the page opens. JSON.parse is the opposite of stringify: text back into
// an object. Every value is checked before use, because someone could have edited the saved text.
function loadSettings(){
  let d;
  try{ d = JSON.parse(localStorage.getItem(SAVE_KEY)); }catch(e){ return; }
  if(!d || typeof d !== 'object') return;
  // Saved text can be edited by anyone, so check every value before using it.
  const tz = resolveTz(d.tz);
  if(tz){ S.tz = tz; S.start = todayStr(tz); }
  if([7,14,21,28,42].includes(d.days)) S.days = d.days;
  if(Number.isInteger(d.from) && Number.isInteger(d.to) && d.from >= 0 && d.from <= 1380 && d.to > d.from && d.to <= 1440 && d.from % 30 === 0 && d.to % 30 === 0){ S.from = d.from; S.to = d.to; }
  if(Array.isArray(d.dows) && d.dows.length === 7) S.dows = d.dows.map(x => x ? 1 : 0);
  if([30,45,60,90,120,180,240,360].includes(d.dur)) S.dur = d.dur;
  if([0,15,30,60].includes(d.buf)) S.buf = d.buf;
  ['allDay','snap','titles'].forEach(k => { if(typeof d[k] === 'boolean') S[k] = d[k]; });
  if(d.sort === 'soon' || d.sort === 'long') S.sort = d.sort;
}

/* init */
// START-UP. These lines run once when the page opens, in order: choose the default sort, load any saved
// settings, fill in the dropdowns, then draw everything for the first time.
S.sort = 'soon';
loadSettings();
buildSelectors();
refresh();
