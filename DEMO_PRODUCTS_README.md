# Demo Products for Supplier Marketplace

## Summary
✓ **42 realistic demo products seeded** into the marketplace

### Product Distribution by Category
- **Electrical Tools** (16): Drills, impact wrenches, grinders, fish tape, etc.
- **Repair Equipment** (12): Screwdriver sets, clamps, workbenches, vacuums, etc.
- **Safety Gear** (4): Gloves, safety glasses, duct tape, eye protection
- **Plumbing Tools** (3): Pipe wrenches, spanner wrenches, brass valves
- **Spare Parts** (7): Wire, connectors, circuit breakers, drill bits, solder

### Features
- ✓ High-quality placeholder images from Unsplash (real tool/equipment photos)
- ✓ Realistic pricing in INR (₹399 - ₹12,999)
- ✓ Discount pricing included (5-30% off)
- ✓ Product descriptions and supplier info
- ✓ Marked as demo with ID prefix: `demo-product-001` through `demo-product-042`
- ✓ All products assigned to "Demo Store" supplier

### Database Files
- `seed-demo-products.json` - Raw product data (40KB)
- `seed-demo-products-v2.sql` - SQL INSERT statements (31KB)
- `seed-demo-products-api.json` - API format for future imports (36KB)

### To Remove Demo Products
When testing is complete, remove all demo data:
```sql
DELETE FROM products WHERE id LIKE 'demo-product-%';
```

Or via psql:
```bash
psql "$DATABASE_URL" -c "DELETE FROM products WHERE id LIKE 'demo-product-%';"
```

### Marketplace Features Enabled
- ✓ Browse all 42 products by category
- ✓ Search products by name and supplier
- ✓ Filter by category (Electrical Tools, Repair Equipment, etc.)
- ✓ Sort by newest, price (↑/↓), and popularity
- ✓ Flash deals section (auto-calculated from product views)
- ✓ Top suppliers section
- ✓ Product detail pages with full descriptions
- ✓ Add to cart functionality
- ✓ Cart with quantity selector
- ✓ Checkout flow with delivery details
- ✓ Order placement

### Testing Checklist
- [ ] Marketplace loads with all 42 products
- [ ] Categories show correct product counts
- [ ] Search filters work
- [ ] Cart functionality works
- [ ] Checkout flow completes
- [ ] Product images display correctly
- [ ] Ratings and reviews display
- [ ] Supplier store page shows correct products
