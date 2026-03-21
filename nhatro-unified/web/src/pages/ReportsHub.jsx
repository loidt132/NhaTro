
import React, { useState } from 'react';
import { TenantsReport, RoomsReport, PaymentsReport, DebtReport } from './reports';

export default function ReportsHub(){
  const [tab, setTab] = useState('rooms');
  const Tab = ({ id, children }) => (
    <button onClick={()=>setTab(id)} className={'px-3 py-2 rounded ' + (tab===id? 'bg-emerald-600 text-white':'bg-slate-100')}>{children}</button>
  );
  return (
    <div className="p-2 space-y-3">
      <div className="flex gap-2">
        <Tab id="rooms">Tổng số phòng</Tab>
        <Tab id="tenants">Tổng số khách</Tab>
        <Tab id="payments">Tiền đã đóng</Tab>
        <Tab id="debt">Công nợ</Tab>
      </div>
      {tab==='rooms' && <RoomsReport/>}
      {tab==='tenants' && <TenantsReport/>}
      {tab==='payments' && <PaymentsReport/>}
      {tab==='debt' && <DebtReport/>}
    </div>
  );
}
