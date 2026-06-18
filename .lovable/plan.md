## Problem

On the admin `/calendar` page, tapping **مشاركة التقويم** shows the error "تعذر نسخ الرابط" on mobile (Huawei Browser in the screenshot). Cause: `navigator.clipboard.writeText` is unavailable or blocked in many mobile browsers, so the `try` block throws.

## Fix

Update `ShareButton` in `src/routes/calendar.tsx` with a layered approach so it always works:

1. **Try the Web Share API first** (`navigator.share`) — on mobile this opens the native share sheet (WhatsApp, copy, etc.), which is the most natural UX for sharing a link with customers.
2. **Fallback to `navigator.clipboard.writeText`** when Web Share isn't available (desktop).
3. **Fallback to a hidden `<textarea>` + `document.execCommand("copy")`** for older/locked-down mobile browsers where neither modern API works.
4. **Final fallback**: show a small dialog with the URL in a selectable input and a "Copy" button, so the user can always copy manually.

Toast messages stay in Arabic ("تم نسخ الرابط!" / share sheet opened). No other files change. No backend or public calendar changes.
