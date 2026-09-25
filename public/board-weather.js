export const WARREN = Object.freeze({latitude:41.73,longitude:-71.28,label:'Warren, RI',timezone:'America/New_York'});
export function currentHour(stamp, now=Date.now()) {
  return Number.isFinite(stamp) && stamp*1000<=now && now<(stamp+3600)*1000;
}
export function localDayIndex(times=[], timezone=WARREN.timezone, now=Date.now()) {
  const date=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  const today=date.format(now);
  return times.findIndex(stamp=>Number.isFinite(stamp)&&date.format(stamp*1000)===today);
}
// Use the containing hour only; never borrow a future or yesterday's value.
export function localConditions(conditions, now=Date.now()) {
  const hourly=conditions?.hourly, i=hourly?.time?.findIndex(t=>currentHour(t,now)) ?? -1;
  const current={...conditions?.current}, fallbackFields=[];
  for(const field of ['temperature_2m','apparent_temperature','relative_humidity_2m','wind_speed_10m','wind_direction_10m','wind_gusts_10m','dew_point_2m','cloud_cover','weather_code','is_day']) {
    if(!Number.isFinite(current[field])&&i>=0&&Number.isFinite(hourly[field]?.[i])){current[field]=hourly[field][i];fallbackFields.push(field);}
  }
  return {current,fallbackFields};
}
export function weatherEffect(code,isDay=1){
  if(!Number.isFinite(code))return 'neutral';
  if(code>=95)return 'storm';
  if([71,73,75,77,85,86].includes(code))return 'snow';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))return 'rain';
  if([45,48].includes(code))return 'fog';
  if(code===3)return 'cloudy';
  if(code===1||code===2)return isDay===0?'night-cloudy':'partly-cloudy';
  return isDay===0?'night':'sunny';
}
