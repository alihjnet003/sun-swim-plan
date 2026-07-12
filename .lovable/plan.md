## Goal

اجعل مدة الحجز مرنة: بإمكان الأدمن (أو العميل) تمديد الحجز إلى ساعات أطول من الفترة الافتراضية، ويتم تعديل بقية فترات نفس اليوم تلقائياً حول الحجز الممتد.

## 1. تعديلات قاعدة البيانات

إضافة عمودين اختياريين على `bookings`:

- `custom_start_time TIME NULL`
- `custom_end_time TIME NULL`

فارغة = استخدم أوقات الـ slot الأصلي كما هو. عند التعبئة = الحجز يمتد على هذه المدة (source of truth للوقت).

يُبقى `slot_id` للربط، وتُعرض أوقات الحجز على التقويم من `custom_*` عند وجودها.

## 2. منطق ضبط الفترات (server function)

`adjustSlotsForBooking(bookingId)` تعمل داخل transaction، بعد أي إنشاء/تعديل حجز يحتوي أوقات مخصصة:

- تجلب الحجز + كل الـ slots في نفس التاريخ.
- لكل slot آخر في اليوم يتقاطع مع `[custom_start, custom_end)` **وليس** هو slot الحجز نفسه:
  - إذا كان الـ slot **محجوز** لعميل آخر → ترفض العملية (خطأ: يوجد تعارض).
  - إذا كان **فارغ** ومغطى بالكامل → يُحذف.
  - إذا **متداخل جزئياً** → يُرجع تعارضاً للواجهة مع قائمة الفترات المتأثرة كي يختار الأدمن (حذف / تقليص). التقليص = تعديل `start_time` أو `end_time` ليصبح خارج نطاق الحجز، مع الحفاظ على الجانب الأطول للفترة.
- الـ slot المرتبط بالحجز نفسه يُحدَّث ليطابق `custom_start/end_time` (كي يظهر الوقت الصحيح في كل الاستعلامات القديمة).

## 3. واجهة الأدمن — BookingModal

- إضافة حقلي وقت (`start_time` / `end_time`) داخل قسم "Booking" مبدئياً بقيم الـ slot.
- عند الحفظ إذا تغيّرت الأوقات: نستدعي server function `updateBookingTimes({ bookingId, start, end, overlapDecisions? })`.
- إذا رجع تعارض جزئي → نفتح Dialog يعرض كل فترة متضاربة مع خيارين لكل واحدة: "حذف" أو "تقليص"، ثم نعيد الاستدعاء مع القرارات.
- تُعرض أوقات الحجز الجديدة على شارات التقويم و الـ Sheet مباشرة بعد `invalidate()`.

## 4. صفحة الحجز العامة (`/public/calendar`)

- عند فتح يوم في الـ Sheet: بعد قائمة الفترات، زر "احجز عدة فترات متتالية" يفتح واجهة اختيار عدة فترات متتالية متاحة.
- يتم إرسال الطلب عبر `bookMultipleSlots` server function (public) الذي:
  - يتحقق أن كل الفترات متتالية زمنياً ومتاحة.
  - يُنشئ حجزاً واحداً على أول slot مع `custom_start_time` = بداية أول فترة و `custom_end_time` = نهاية آخر فترة.
  - يُشغِّل نفس منطق `adjustSlotsForBooking` لحذف باقي الفترات المتتالية.

## 5. عرض البيانات

- تعديل `queries.ts` والمكونات (`calendar.tsx`, `public.calendar.tsx`, `bookings.tsx`, `BookingModal`, `invoice-pdf`) لعرض `custom_start_time ?? slot.start_time` و `custom_end_time ?? slot.end_time` عبر helper واحد (`bookingTimeRange(b)`).

## Technical Details

- Migration واحدة لإضافة الأعمدة + دالة SQL `public.adjust_slots_for_booking(uuid)` تعيد JSON بالحالات (`{ ok: true }` أو `{ conflicts: [...] }`) وتُطبِّق التعديلات ضمن transaction. حماية بـ `SECURITY DEFINER` + فحص صلاحية `is_staff_or_admin` أو ملكية الحجز.
- تعديلات الأدمن تمر عبر server function مع `requireSupabaseAuth` تنادي RPC.
- حجز العميل يمر عبر server route عام (`/api/public/…`) أو مباشرة على supabase مع RLS بسيط: `INSERT` على bookings/customer مسموح لـ anon كما هو حالياً.
- تحديث `src/integrations/supabase/types.ts` يحدث تلقائياً بعد الـ migration.

## What NOT to change

- لا تغيير لنظام المصادقة أو الأدوار أو الـ backup أو الفواتير.
- منطق `auto_close_past_slots` و pg_cron يبقى كما هو.
- لن أُعدّل السلوك الافتراضي للحجوزات القصيرة التي لا تستخدم `custom_*`.
