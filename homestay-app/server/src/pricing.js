import dayjs from "dayjs";

// cutoff: 12:00 of the calendar day AFTER the segment's check-in date.
// Used by both "overnight" (22h-12h) and "fullday" (14h-12h) plans — the
// free period always ends at noon the next day; staying past that incurs
// the late-checkout surcharge instead of re-pricing the whole stay.
function nextDayNoon(checkInAt) {
  return dayjs(checkInAt).add(1, "day").hour(12).minute(0).second(0);
}

export function computeSegmentCharge(segment, ratePlan) {
  const { pricingType, checkInAt, checkOutAt } = segment;
  const start = dayjs(checkInAt);
  const end = dayjs(checkOutAt);
  const lines = [];

  if (pricingType === "hourly") {
    const rawHours = end.diff(start, "minute") / 60;
    const durationHours = Math.max(1, Math.ceil(rawHours));
    const firstBlock = ratePlan.hourlyFirstBlockHours;
    if (durationHours <= firstBlock) {
      lines.push({
        label: `Giá theo giờ (${firstBlock}h đầu)`,
        amount: ratePlan.hourlyFirstBlockPrice,
      });
    } else {
      lines.push({
        label: `Giá theo giờ (${firstBlock}h đầu)`,
        amount: ratePlan.hourlyFirstBlockPrice,
      });
      const extraHours = durationHours - firstBlock;
      lines.push({
        label: `Phụ thu ${extraHours}h tiếp theo x ${ratePlan.hourlyExtraPricePerHour.toLocaleString("vi-VN")}đ`,
        amount: extraHours * ratePlan.hourlyExtraPricePerHour,
      });
    }
    return lines;
  }

  if (pricingType === "overnight" || pricingType === "fullday") {
    const basePrice = pricingType === "overnight" ? ratePlan.overnightPrice : ratePlan.fullDayPrice;
    const label = pricingType === "overnight" ? "Giá qua đêm (22h - 12h hôm sau)" : "Giá cả ngày (14h - 12h hôm sau)";
    lines.push({ label, amount: basePrice });

    const cutoff = nextDayNoon(start);
    if (end.isAfter(cutoff)) {
      const extraHours = Math.max(1, Math.ceil(end.diff(cutoff, "minute") / 60));
      lines.push({
        label: `Phụ thu trả phòng muộn ${extraHours}h x ${ratePlan.lateCheckoutPricePerHour.toLocaleString("vi-VN")}đ`,
        amount: extraHours * ratePlan.lateCheckoutPricePerHour,
      });
    }
    return lines;
  }

  throw new Error(`Unknown pricingType: ${pricingType}`);
}

// Room charge covers the whole stay (original check-in to checkout/now) as
// ONE continuous duration, priced with whichever room the guest is in now.
// Room transfers are an audit trail (see roomTransfers), not separate
// billing periods — switching rooms must never re-trigger the first-block
// price or double-count time already billed.
export function computeStayRoomCharge(stay, currentRatePlan, endAt) {
  return computeSegmentCharge(
    { pricingType: stay.pricingType, checkInAt: stay.checkInAt, checkOutAt: endAt },
    currentRatePlan
  );
}
