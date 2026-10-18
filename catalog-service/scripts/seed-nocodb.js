// One-off dummy-data loader for the NocoDB tables this service uses.
// Run with: npm run seed  (reads .env via --env-file, see package.json)
import { v4 as uuid } from "uuid";
import { listRows, createRow } from "../src/nocodb.js";

const categories = [
  { name: "Ăn uống" },
  { name: "Giặt là" },
  { name: "Đồ dùng thêm" },
];

const items = [
  { categoryName: "Ăn uống", name: "Nước suối", unit: "chai", price: 15000, kind: "service" },
  { categoryName: "Ăn uống", name: "Bia lon", unit: "lon", price: 25000, kind: "service" },
  { categoryName: "Ăn uống", name: "Mì tôm", unit: "gói", price: 20000, kind: "service" },
  { categoryName: "Giặt là", name: "Giặt sấy đồ nhẹ", unit: "lượt", price: 50000, kind: "service" },
  { categoryName: "Giặt là", name: "Giặt sấy đồ nặng", unit: "lượt", price: 90000, kind: "service" },
  { categoryName: "Đồ dùng thêm", name: "Bộ bàn chải đánh răng", unit: "bộ", price: 10000, kind: "service" },
  { categoryName: "Đồ dùng thêm", name: "Khăn tắm thêm", unit: "cái", price: 20000, kind: "service" },
  { categoryName: null, name: "Phụ thu khách thứ 3 trở lên", unit: "khách/lượt", price: 50000, kind: "surcharge" },
  { categoryName: null, name: "Phụ thu nhận phòng sau 0h", unit: "lượt", price: 30000, kind: "surcharge" },
  { categoryName: null, name: "Phụ thu mang theo thú cưng", unit: "lượt", price: 100000, kind: "surcharge" },
];

async function main() {
  const existingCategories = await listRows("categories");
  const existingItems = await listRows("items");
  if (existingCategories.length || existingItems.length) {
    console.log(
      `Đã có sẵn dữ liệu (${existingCategories.length} danh mục, ${existingItems.length} dịch vụ/phụ thu) — bỏ qua seed để tránh trùng lặp.`
    );
    return;
  }

  const categoryIdByName = {};
  for (const c of categories) {
    const row = await createRow("categories", { id: uuid(), name: c.name });
    categoryIdByName[c.name] = row.id;
    console.log(`+ category ${c.name}`);
  }

  for (const i of items) {
    await createRow("items", {
      id: uuid(),
      categoryId: i.categoryName ? categoryIdByName[i.categoryName] : null,
      name: i.name,
      unit: i.unit,
      price: i.price,
      kind: i.kind,
    });
    console.log(`+ item ${i.name}`);
  }

  console.log("Xong.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
