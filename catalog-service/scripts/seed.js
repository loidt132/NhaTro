// Seeds a starter dịch vụ/phụ thu price list for ONE homestay.
// Run with: npm run seed -- <homestayId>
import { v4 as uuid } from "uuid";
import { listCategories, listItems, createCategory, createItem } from "../src/db.js";

const homestayId = process.argv[2];
if (!homestayId) {
  console.error("Thiếu homestayId. Chạy: npm run seed -- <homestayId>");
  process.exit(1);
}

const categories = ["Ăn uống", "Giặt là", "Đồ dùng thêm"];

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

const existingCategories = await listCategories(homestayId);
const existingItems = await listItems(homestayId);
if (existingCategories.length || existingItems.length) {
  console.log(`Homestay ${homestayId} đã có ${existingCategories.length} danh mục, ${existingItems.length} dịch vụ/phụ thu — bỏ qua seed.`);
  process.exit(0);
}

const categoryIdByName = {};
for (const name of categories) {
  const row = await createCategory({ id: uuid(), homestayId, name });
  categoryIdByName[name] = row.id;
  console.log(`+ category ${name}`);
}
for (const i of items) {
  await createItem({
    id: uuid(),
    homestayId,
    categoryId: i.categoryName ? categoryIdByName[i.categoryName] : null,
    name: i.name,
    unit: i.unit,
    price: i.price,
    kind: i.kind,
  });
  console.log(`+ item ${i.name}`);
}
console.log("Xong.");
process.exit(0);
