
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TenantsReport, RoomsReport, PaymentsReport, AdvanceReport } from './reports';
import Page from '../components/Page';
import Footer from '../components/Footer';
import { hydrateState } from '../utils/state';

export default function ReportsHub(){
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'rooms');
  useEffect(() => {
    if (tab === 'rooms') {
      hydrateState({ tables: ['rooms', 'tenants'] });
    } else if (tab === 'tenants') {
      hydrateState({ tables: ['rooms', 'tenants'] });
    } else if (tab === 'payments') {
      hydrateState({ tables: ['rooms', 'tenants', 'invoices', 'payments', 'rentPeriods', 'paymentAllocations'] });
    } else if (tab === 'advance') {
      hydrateState({ tables: ['rooms', 'tenants', 'rentPeriods', 'paymentAllocations'] });
    }
  }, [tab]);
  useEffect(() => { const requested = searchParams.get('tab'); if (requested && requested !== tab) setTab(requested); }, [searchParams]);
  const Tab = ({ id, children }) => (
    <button onClick={()=>{ setTab(id); setSearchParams({ tab: id }); }} className={'h-[29px] rounded px-2 text-[11px] ' + (tab===id? 'bg-emerald-600 text-white':'bg-slate-100')}>{children}</button>
  );
  return (
    <Page className="space-y-3">
      <div className="flex flex-wrap justify-end gap-1.5">
        <Tab id="rooms">Danh sách phòng</Tab>
        <Tab id="tenants">Danh sách khách</Tab>
        <Tab id="payments">Báo cáo thanh toán</Tab>
        <Tab id="advance">Đóng trước</Tab>
      </div>
      {tab==='rooms' && <RoomsReport/>}
      {tab==='tenants' && <TenantsReport/>}
      {tab==='payments' && <PaymentsReport/>}
      {tab==='advance' && <AdvanceReport/>}
      <Footer />
    </Page>
  );
}
