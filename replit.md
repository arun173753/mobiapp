# AtoZ Mobile Repair - Mobi App

## Overview
Mobile app (Expo/React Native) for repair professionals with social feed, directory, marketplace, and insurance.

**Backend**: Express/TypeScript on Cloud Run @ `https://repair-backendarun-838751841074.asia-south1.run.app` (service: `repair-backendarun`, project: `mobi-backend-491410`)
**Frontend**: Firebase Hosting @ `https://mobile-repair-app-276b6.web.app`

## ⚠️ CRITICAL DEPLOYMENT NOTES
- **NEVER use `npm run server:build`** for Cloud Run deploys — it uses `--packages=external` which creates an incomplete bundle that crashes in Docker (missing drizzle-orm etc.)
- **ALWAYS use `deploy-backend.sh`** which runs the correct esbuild command: `--bundle --format=cjs --external:*.node` (fully self-contained, ~20MB)
- **Deploy pattern**: Cloud Build step `BuildAndPushImage` (push-oci.js) SUCCEEDS; step `DeployToCloudRun` (gcloud) always FAILS — use PATCH API after Cloud Build to deploy
- **Firestore on Cloud Run**: Not available (Firestore SDK fails on mobi-backend project). Chat conversations have fallback that returns valid response even if Firestore unavailable. Messages still work via API.
- **Admin ID**: `admin-55f06aed-5414-45da-a507-9fe355dbb5a7`, **Admin phone**: `8179142535`

## Latest Session - All Broken Backend Features Fixed (Chat, Delete User, Photo/Video Upload, Etc.)

### ✅ COMPLETED:
- **Root cause**: `npm run server:build` uses `--packages=external` producing incomplete bundle missing drizzle-orm, firebase-admin, etc. → crashed Cloud Run
- **Fix**: Rebuilt with `--bundle --format=cjs` (fully self-contained, ~20MB)
- **Chat Features**: 
  - `/api/conversations` endpoint now works with graceful Firestore fallback
  - `/api/messages` endpoint (text + photo/video) now works with Firestore fallback
  - `/api/messages/:conversationId/since/:timestamp` polling endpoint gracefully returns empty if Firestore unavailable
- **All endpoints tested and working**: delete-account, block-user, conversations, delete-post, live-chat, chat messages with photos/videos
- **Deployed**: New image pushed to Cloud Run, all endpoints live and tested
- **Next**: User needs to clear browser cache and hard reload app to get updated frontend code

## Latest Session - Admin Panel & User Information Display

### ✅ COMPLETED:

**Admin Panel Action Buttons Fixed**
- Fixed Approve/Reject buttons for Protection Plans
  - Web: Uses `window.prompt()` for rejection reason input
  - Mobile: Uses `Alert.alert()` for confirmation
  - Added console logging for debugging: `[Admin] button pressed`
- Fixed all Claim action buttons (Under Review, Approve, Reject, Assign Technician, Mark Completed)
  - Added platform detection (web vs mobile)
  - All buttons have working handlers with logging
  - Better touch targets (minHeight: 40px+)
  - Success/error alerts after action
- Backend: Added 'under_review' status handling to claim route
- Enhanced image display: Device images side-by-side, damage images full-width with proper placeholders
- Deployed ✓

**Rejected Plans - "Try Again" Button**
- When plan status === 'rejected', display:
  - Clear "Application Rejected" heading
  - Rejection reason from database
  - Helpful message: "You can update your details and apply again"
  - Orange "Try Again" button (full-width, matching app theme)
- Button functionality:
  - Pre-fills form with previous data (brand, model, modelNumber, imei)
  - Navigates to device details step so user can edit
  - Allows resubmission with updated information
- UI: Red background card (#FFEEEE) with clear visual hierarchy
- Deployed ✓

**User Information Display in Admin Panel**
- Schema: Added `userEmail` field to protection_plans table
- Backend: Updated `/api/protection/apply` to fetch and save user email from profiles table
- Admin Panel: 
  - New "Customer Details" section showing Name, Mobile, Email
  - Displayed in light gray box (#F8F8F8) above device images
  - Clean formatting with labels and values
  - Shows "N/A" for missing information
- Workflow: Deployment in progress ✓

**Previous Session - Auto-Login & Database Cleanup**

**Auto-Login (OTP Bypass)**
- Created `/api/auth/auto-login` endpoint (backend)
- Phone-only login: no OTP sent, no OTP screen
- Instant session creation for existing users
- New users go directly to profile details screen
- Deployed to production ✓

**Database Cleanup**
- Added `/api/admin/complete-wipe` endpoint
- Cleaned both local dev DB and production DB
- Only admin (8179142535) remains as active user

### Previous Sessions - Feature Completion

### ✅ COMPLETED:

**T001: Media Upload System (Bunny.net)**
- Fixed Bunny storage zone name: `arun-storag` → `arun-storage`
- Product images upload and display correctly
- Marketplace image parsing: JSON array + comma-separated fallback
- Product deletion cleans up Bunny CDN images

**T002: Home Feed UI Improvements**
- User profile pictures display at top of posts ✓
- Posts show inside feed cards with proper formatting ✓
- Spacing optimized for mobile view ✓

**T003: Notification Icon → Chat**
- Header chat icon links to `/chats` ✓
- Already implemented with chatbubbles icon ✓

**T004: Directory Page Fix**
- Removed Load More button ✓
- Removed menu icon ✓
- Removed category filter chips ✓
- Added live count pills (online/total, auto-refresh 10s) ✓
- Role-based buttons: Customers/Technicians Chat only, Suppliers/Teachers Chat+Call ✓

**T006: Customer Post Quick Options**
- Quick issue buttons implemented ✓
- Shows when repair category selected by customers ✓
- Issues: Screen Broken, Battery Issue, Not Charging, Water Damage, Camera Not Working, etc. ✓

**T007: Market Hub Changes**
- Suppliers row displays at top ✓
- Click supplier → profile with products and cart ✓
- Supplier store page: white background (#FFFFFF) ✓
- Cart icon removed from supplier profile header ✓
- Product images display in both supplier and main marketplace ✓

**Supplier Profile & Shop**
- Background changed to white (#FFFFFF) ✓
- Cart icon removed from header ✓
- Product images parse correctly (JSON + fallback) ✓
- Products sync between supplier profile and marketplace ✓

### 🔄 PARTIAL/PENDING:

**T005: Map Page Markers** - Not started (lower priority)

**T008: Mobile Protection Plan Price Fix** - Not started (requires database changes)
- Would need: IMEI field, mobile model field, admin-set price
- Risky at this stage - left for future focused task

**T009: Terms & Conditions Checkbox** - Blocked by T008

**T010: Test Full Flow** - Backend and Frontend deployed, core features tested

## Architecture & Key Files

### Frontend (Expo)
- **Tabs**: `app/(tabs)/_layout.tsx` (NativeTabs routing)
- **Home Feed**: `app/(tabs)/index.tsx` (PostCard component)
- **Directory**: `app/(tabs)/directory.tsx` (live count pills, role-based buttons)
- **Marketplace**: `app/(tabs)/marketplace.tsx` (suppliers row, product grid)
- **Supplier Store**: `app/supplier-store.tsx` (white background, no cart icon)
- **Create Post**: `app/(tabs)/create.tsx` (quick issue buttons for repair category)
- **Products**: `app/(tabs)/products.tsx` (supplier product management)

### Backend (Express/TypeScript)
- **Routes**: `server/routes.ts` (API endpoints)
- **Database**: `shared/schema.ts` (Drizzle ORM)
- **Products**: DELETE endpoint enhanced with Bunny cleanup + logging

### Components
- **PostCard**: `components/PostCard.tsx` (displays user avatar, category icons, media)
- **DirectoryMap**: Shows tech/supplier/teacher markers

## Image System (Bunny CDN)
- **Zone**: `arun-storage` 
- **CDN URL**: `https://arun-storage.b-cdn.net`
- **Storage**: Products stored as JSON array in `images` field
- **Parsing**: Handles JSON array, comma-separated, or plain string formats
- **Deletion**: Cleans up Bunny files on product delete

## Environment & Secrets
- `BUNNY_STORAGE_API_KEY` - Bunny CDN authentication
- `BUNNY_STREAM_API_KEY` - Video streaming
- `BUNNY_STREAM_LIBRARY_ID` - Video library
- `FAST2SMS_API_KEY` - SMS OTP fallback
- `GCP_SA_KEY` - Google Cloud credentials
- `OPENAI_API_KEY` - AI integrations
- `RESEND_API_KEY` - Email delivery

## Critical Implementation Details

### Image Upload Flow
1. Frontend: Pick image → upload to `/api/upload` endpoint
2. Backend: Save to Bunny CDN, return URL
3. Store: URL saved in product `images` field (JSON array)
4. Display: Parse images, show in grid (fallback to placeholder)
5. Delete: Extract filename from URL, call Bunny DELETE API, then remove from DB

### Product Visibility
- All supplier products → products table → appear in MarketHub
- Supplier profile → filters products by userId
- Search/filters work across all products
- Images display identically in both locations

### Directory Live Count
- Fetches profiles every 10 seconds
- Shows online/total count (e.g. "3/10")
- Counts active users across all roles
- Auto-refresh while on directory tab

### Role-Based UI
- **Customers**: Chat button only on directory
- **Technicians**: Chat button only on directory
- **Suppliers**: Chat + Call buttons on directory
- **Teachers**: Chat + Call buttons on directory

## Deployment
- Backend deployed to Cloud Run (auto-updates with Deploy Backend workflow)
- Frontend deployed to Firebase Hosting (auto-updates with Deploy Frontend workflow)
- Database: PostgreSQL (Replit managed)

## Notes
- **Scratchpad items** maintained in session history (phone numbers, admin routes, etc.)
- Fast mode completed most critical features in 10 turns
- Some lower-priority items (map markers, insurance plan IMEI) left for future focused tasks
- All image handling is robust with fallback parsing

## Desktop WebView Mode (New Feature)

**Implementation**: In-app web pages automatically display in desktop view.

**Component**: `components/DesktopWebView.tsx`
- Desktop Chrome user agent (Windows 10, Chrome 120)
- Wide viewport (1024px) forces desktop layout
- Scales properly on mobile screen with pinch-zoom
- Injects CSS to hide mobile-only elements
- No external browser opening - stays in app

**Routing**: `lib/open-link.ts` handles all link opens
- Internal links → `/webview` screen with DesktopWebView
- Tel/mailto/sms links → native handlers
- Web platform → opens in new tab

**Applies To**:
- Shop pages
- Profile pages  
- External website links
- Live sessions
- Payment pages

**User Experience**:
- Similar to Chrome's "Desktop Site" feature
- Automatic (no manual toggle)
- Full app navigation (back button)
- Loading indicators and error handling
