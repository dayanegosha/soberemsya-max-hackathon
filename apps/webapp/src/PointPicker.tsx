import {useEffect,useRef,useState} from 'react';
import type {Coordinates} from '../../../packages/types/src/index';
import {distanceKm,parseCoordinates,type City,type MeetingPoint} from '../../../packages/shared/src/cities';
import {savedPoints,savePoint} from './location';
import {ActionButton} from './ui';
import 'leaflet/dist/leaflet.css';
function PointMap({point,onChange}:{point:Coordinates;onChange:(p:Coordinates)=>void}){
 const container=useRef<HTMLDivElement>(null), handler=useRef(onChange);handler.current=onChange;
 const instance=useRef<import('leaflet').Map|null>(null), marker=useRef<import('leaflet').CircleMarker|null>(null);
 useEffect(()=>{let gone=false;void import('leaflet').then(L=>{if(gone||!container.current)return;const map=L.map(container.current).setView([point.lat,point.lon],13);instance.current=map;
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{referrerPolicy:'origin',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);
 marker.current=L.circleMarker([point.lat,point.lon],{radius:10,color:'#6345de',fillColor:'#6345de',fillOpacity:0.85,weight:3}).addTo(map);
 map.on('click',(e:import('leaflet').LeafletMouseEvent)=>handler.current({lat:+e.latlng.lat.toFixed(6),lon:+e.latlng.lng.toFixed(6)}));});return()=>{gone=true;instance.current?.remove();instance.current=null;};},[]);
 useEffect(()=>{marker.current?.setLatLng([point.lat,point.lon]);instance.current?.panTo([point.lat,point.lon]);},[point.lat,point.lon]);
 return <div className="point-map" ref={container} aria-label="Карта выбора точки встречи"/>;
}
export function PointPicker({city,point,name,onChange}:{city:City;point:Coordinates;name:string;onChange:(p:Coordinates,name:string)=>void}){
 const [custom,setCustom]=useState(false),[draft,setDraft]=useState(point),[label,setLabel]=useState(''),[coords,setCoords]=useState(''),[error,setError]=useState(''),[own,setOwn]=useState(()=>savedPoints(city));
 useEffect(()=>{setOwn(savedPoints(city));setCustom(false);setError('');},[city.id]);
 const choose=(p:MeetingPoint)=>onChange({lat:p.lat,lon:p.lon},p.name);
 const apply=()=>{const p=coords?parseCoordinates(coords):draft;if(!p||distanceKm(city.center,p)>city.coverageKm){setError('Укажите точку в пределах города. Координаты: широта, долгота.');return;}if(!label.trim()){setError('Назовите место встречи.');return;}const item={...p,id:crypto.randomUUID(),name:label.trim()};savePoint(city,item);setOwn(savedPoints(city));choose(item);setCustom(false);setError('');};
 return <div className="point-picker"><label>Место встречи<select aria-label="Точка встречи" value={[...own,...city.points].find(p=>p.name===name)?.id??'current'} onChange={e=>{const p=[...own,...city.points].find(x=>x.id===e.target.value);if(p)choose(p);}}><option value="current" disabled>{name}</option>{own.length>0&&<optgroup label="Мои места">{own.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}<optgroup label="Популярные места">{city.points.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup></select></label>
 <button className="text-button" type="button" onClick={()=>{setDraft(point);setCoords('');setLabel('');setCustom(!custom);}}>+ Своя точка на карте</button>
 {custom&&<div className="custom-point"><p className="small muted">Нажмите на карту или введите координаты. Место будет видно участникам встречи.</p><PointMap point={draft} onChange={p=>{setDraft(p);setCoords('');}}/><label>Название<input value={label} maxLength={80} placeholder="Например, у выхода из метро" onChange={e=>setLabel(e.target.value)}/></label><label>Координаты<input value={coords||`${draft.lat}, ${draft.lon}`} onChange={e=>setCoords(e.target.value)} placeholder="59.9386, 30.3141"/></label>{error&&<p role="alert" className="field-error">{error}</p>}<div className="point-actions"><ActionButton variant="secondary" onClick={()=>setCustom(false)}>Отмена</ActionButton><ActionButton onClick={apply}>Выбрать точку</ActionButton></div></div>}
 </div>;
}
