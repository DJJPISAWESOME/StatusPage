export const WARREN = Object.freeze({latitude:41.73,longitude:-71.28,label:'Warren, RI',timezone:'America/New_York'});
export function currentHour(stamp, now=Date.now()) {
  return Number.isFinite(stamp) && stamp*1000<=now && now<(stamp+3600)*1000;
}
export function localDayIndex(times=[], timezone=WARREN.timezone, now=Date.now()) {
  const date=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  const today=date.format(now);
  return times.findIndex(stamp=>Number.isFinite(stamp)&&date.format(stamp*1000)===today);
}
