
import React from 'react';
import { currency } from '../utils/state';
export default function RoomCard({ room, tenant, invoice, onCreateInvoice, onTogglePaid }){
  const status = invoice?.status || 'Còn nợ';
  const badge = status==='Đã thanh toán' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700';
  const total = invoice?.total || room.baseRent || 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">PHÒNG {room.name}</div>
        <span className={`rounded-full px-2 py-1 text-xs ${badge}`}>{status}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><div className="text-slate-500">Tiền phòng</div><div className="font-medium">{currency(room.baseRent)} đ</div></div>
        <div><div className="text-slate-500">Đơn giá điện</div><div className="font-medium">{currency(room.electricRate)} đ/kWh</div></div>
        <div><div className="text-slate-500">Đơn giá nước</div><div className="font-medium">{currency(room.waterRate)} đ/m³</div></div>
        <div><div className="text-slate-500">Khách</div><div className="font-medium">{tenant?.name || '—'}</div></div>
      </div>
      <div className="flex items-center justify-between pt-2">
        <div className="text-lg font-semibold">{currency(total)} đ</div>
        <div className="flex items-center gap-2">
          {invoice ? (
            <button onClick={()=>onTogglePaid && onTogglePaid(invoice.id)} className="rounded-lg bg-emerald-600 text-white px-3 py-1 text-sm">{status==='Đã thanh toán'?'Đánh dấu còn nợ':'Đánh dấu đã trả'}</button>
          ):(
            <button onClick={()=>onCreateInvoice && onCreateInvoice()} className="rounded-lg bg-emerald-600 text-white px-3 py-1 text-sm">Tạo hóa đơn</button>
          )}
        </div>
      </div>
    </div>
  );
}
