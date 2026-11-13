export const ymd = (d) => d.toISOString().slice(0, 10);

export const addDays = (d, n) => {
  const x = new Date(typeof d === "string" ? d + "T00:00:00Z" : d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

export const todayUTC = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};

export const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

export const dateList = (a, b) => {
  const out = [];
  for (let d = a; d <= b; d = ymd(addDays(d, 1))) out.push(d);
  return out;
};
