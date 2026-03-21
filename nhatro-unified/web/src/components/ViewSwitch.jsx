
import React from 'react';
export default function ViewSwitch({ value='table', onChange }){
  return (
    <div className="inline-flex rounded-xl border bg-white overflow-hidden">
      {['table','cards'].map(v => (
        <button key={v} onClick={()=>onChange && onChange(v)} className={(value===v? 'bg-emerald-600 text-white':'text-slate-700')+' px-3 py-1.5 text-sm'}>
          {v==='table'? 'Bảng' : 'Thẻ'}
        </button>
      ))}
    </div>
  );
}
