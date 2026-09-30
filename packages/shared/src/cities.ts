import type { Coordinates } from '../../types/src/index.js';
export interface MeetingPoint extends Coordinates { id: string; name: string; }
export interface City { id: string; name: string; center: Coordinates; coverageKm: number; points: MeetingPoint[]; }
export const CITIES: City[] = [
  { id: 'moscow', name: 'Москва', center: {lat:55.7512,lon:37.6184}, coverageKm:70, points:[
    {id:'red-square',name:'Красная площадь',lat:55.7539,lon:37.6208},
    {id:'zaryadye',name:'Парк «Зарядье»',lat:55.7510,lon:37.6286},
    {id:'manege',name:'Манежная площадь',lat:55.7536,lon:37.6133},
    {id:'gorky',name:'Парк Горького',lat:55.7298,lon:37.6010},
    {id:'vdnh',name:'Главный вход ВДНХ',lat:55.8240,lon:37.6373},
    {id:'moscow-city',name:'Москва-Сити',lat:55.7489,lon:37.5391},
    {id:'tretyakov',name:'Третьяковская галерея',lat:55.7415,lon:37.6208},
    {id:'arbat',name:'Арбатские ворота',lat:55.7521,lon:37.5927},
    {id:'patriarch',name:'Патриаршие пруды',lat:55.7636,lon:37.5926},
    {id:'depot',name:'Депо. Три вокзала',lat:55.7777,lon:37.6607},
    {id:'flacon',name:'Дизайн-завод «Флакон»',lat:55.8056,lon:37.5853},
    {id:'khlebozavod',name:'Хлебозавод № 9',lat:55.8064,lon:37.5845},
    {id:'muzeon',name:'Парк искусств «Музеон»',lat:55.7352,lon:37.6050},
    {id:'luzhniki',name:'Лужники',lat:55.7158,lon:37.5537},
  ]},
  { id: 'spb', name: 'Санкт-Петербург', center: {lat:59.9386,lon:30.3141}, coverageKm:45, points:[
    {id:'palace',name:'Дворцовая площадь',lat:59.9386,lon:30.3141},
    {id:'gostiny',name:'Гостиный двор',lat:59.9343,lon:30.3352},
    {id:'isaac',name:'Исаакиевская площадь',lat:59.9311,lon:30.3065},
    {id:'holland',name:'Новая Голландия',lat:59.9297,lon:30.2907},
    {id:'sevcable',name:'Севкабель Порт',lat:59.9245,lon:30.2417},
    {id:'spit',name:'Стрелка Васильевского острова',lat:59.9433,lon:30.3063},
    {id:'gorky',name:'Метро «Горьковская»',lat:59.9562,lon:30.3189},
    {id:'summer',name:'Летний сад',lat:59.9433,lon:30.3354},
    {id:'vosstaniya',name:'Площадь Восстания',lat:59.9310,lon:30.3609},
    {id:'elagin',name:'Елагин остров',lat:59.9794,lon:30.2587},
    {id:'rusmuseum',name:'Русский музей',lat:59.9388,lon:30.3322},
    {id:'planetarium',name:'Планетарий № 1',lat:59.9307,lon:30.2940},
    {id:'lenpolygraph',name:'Ленполиграфмаш',lat:59.9718,lon:30.3160},
    {id:'botanical',name:'Ботанический сад Петра Великого',lat:59.9701,lon:30.3237},
  ]},
  { id: 'kazan', name: 'Казань', center: {lat:55.7879,lon:49.1233}, coverageKm:30, points:[
    {id:'tukay',name:'Площадь Тукая',lat:55.7879,lon:49.1233},
    {id:'kremlin',name:'Казанский Кремль',lat:55.7975,lon:49.1064},
    {id:'kaban',name:'Набережная Кабана',lat:55.7795,lon:49.1243},
    {id:'black-lake',name:'Парк «Чёрное озеро»',lat:55.7940,lon:49.1189},
    {id:'embankment',name:'Кремлёвская набережная',lat:55.8035,lon:49.1140},
    {id:'family',name:'Центр семьи «Казан»',lat:55.8128,lon:49.1087},
    {id:'gorky',name:'Парк Горького',lat:55.7972,lon:49.1480},
    {id:'liberty',name:'Площадь Свободы',lat:55.7980,lon:49.1267},
    {id:'bauman',name:'Улица Баумана',lat:55.7903,lon:49.1142},
    {id:'ural',name:'Национальная библиотека Татарстана',lat:55.7971,lon:49.1370},
    {id:'smena',name:'Центр современной культуры «Смена»',lat:55.7970,lon:49.0989},
    {id:'art-space',name:'Галерея современного искусства ГМИИ РТ',lat:55.7912,lon:49.1267},
  ]},
];
export function distanceKm(a: Coordinates,b: Coordinates) {
 const rad=Math.PI/180, dlat=(b.lat-a.lat)*rad, dlon=(b.lon-a.lon)*rad;
 const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function cityBy(value: string | null | undefined) { return CITIES.find(x=>x.id===value||x.name===value); }
export function cityAt(p:Coordinates): City | undefined {
 if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180)return;
 return CITIES.filter(c=>distanceKm(c.center,p)<=c.coverageKm).sort((a,b)=>distanceKm(a.center,p)-distanceKm(b.center,p))[0];
}
export function pointName(city:string,p:Coordinates){return cityBy(city)?.points.find(x=>distanceKm(x,p)<0.05)?.name??'Своя точка';}
export function parseCoordinates(text:string):Coordinates | undefined {
 const m=text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
 if(!m)return; const p={lat:Number(m[1]),lon:Number(m[2])};
 return Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180?p:undefined;
}
