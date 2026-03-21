
import React, { useState } from 'react';
import { TenantsReport, RoomsReport, PaymentsReport } from './reports';
import Page from '../components/Page';
import Footer from '../components/Footer';

export default function ReportsHub(){
  const [tab, setTab] = useState('rooms');
  const Tab = ({ id, children }) => (
    <button onClick={()=>setTab(id)} className={'px-3 py-2 rounded ' + (tab===id? 'bg-emerald-600 text-white':'bg-slate-100')}>{children}</button>
  );
  return (
    <Page className="space-y-3">
      <div className="flex gap-2">
        <Tab id="rooms">Danh sách phòng</Tab>
        <Tab id="tenants">Danh sách khách</Tab>
        <Tab id="payments">Báo cáo thanh toán</Tab>
      </div>
      {tab==='rooms' && <RoomsReport/>}
      {tab==='tenants' && <TenantsReport/>}
      {tab==='payments' && <PaymentsReport/>}
      <Footer />
    </Page>
  );
}
