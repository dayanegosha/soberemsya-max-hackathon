import { cityBy, distanceKm, type City, type MeetingPoint } from '../../../packages/shared/src/cities';
import { request } from './api';
export function savedCity(){try{const raw=localStorage.getItem('soberemsya.city');if(!raw)return undefined;try{const city=JSON.parse(raw) as City;return city?.name&&city?.center&&Array.isArray(city.points)?city:undefined;}catch{return cityBy(raw);}}catch{return undefined;}}
export function rememberCity(city:City){try{localStorage.setItem('soberemsya.city',JSON.stringify(city));}catch{}}
export function locateCity():Promise<City>{return new Promise((resolve,reject)=>{
 if(!navigator.geolocation)return reject(new Error('Геолокация недоступна на этом устройстве.'));
 navigator.geolocation.getCurrentPosition(p=>{void request<City>('/api/location/resolve',{method:'POST',body:JSON.stringify({lat:p.coords.latitude,lon:p.coords.longitude})}).then(resolve,reject);},()=>reject(new Error('Не удалось определить город. Разрешите доступ к геопозиции и попробуйте ещё раз.')),{timeout:12000,maximumAge:60000});
});}
export async function searchCities(query:string):Promise<City[]>{const result=await request<{cities:City[]}>(`/api/location/search?q=${encodeURIComponent(query.trim())}`);return result.cities;}
export async function resolveCity(city:City):Promise<City>{return request<City>('/api/location/resolve',{method:'POST',body:JSON.stringify(city.center)});}
export function savedPoints(city:City):MeetingPoint[]{try{return (JSON.parse(localStorage.getItem('soberemsya.points.'+city.id)||'[]') as MeetingPoint[]).filter(p=>typeof p.name==='string'&&distanceKm(city.center,p)<=city.coverageKm).slice(0,10);}catch{return [];}}
export function savePoint(city:City,p:MeetingPoint){try{localStorage.setItem('soberemsya.points.'+city.id,JSON.stringify([p,...savedPoints(city).filter(x=>x.name!==p.name)].slice(0,10)));}catch{}}
