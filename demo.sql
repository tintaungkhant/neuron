-- -------------------------------------------------------------
-- Better Solutions — Demo Seed Data
-- A Myanmar-based digital marketing & media buying agency.
-- Provides Facebook/TikTok boosting, content creation,
-- design, video production, and consultation services.
-- -------------------------------------------------------------

DROP TABLE IF EXISTS "public"."faqs" CASCADE;
DROP TABLE IF EXISTS "public"."orders" CASCADE;
DROP TABLE IF EXISTS "public"."chats" CASCADE;
DROP TABLE IF EXISTS "public"."payment_methods" CASCADE;
DROP TABLE IF EXISTS "public"."services" CASCADE;

CREATE TABLE "public"."services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"pricing" text NOT NULL,
	"requirements_from_customer" text NOT NULL
);

CREATE TABLE "public"."payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"account_name" text,
	"account_number" text,
	"note" text
);

CREATE TABLE "public"."chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"ext_id" bigint,
	"name" text
);

CREATE TABLE "public"."orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer,
	"summary" text,
	CONSTRAINT "orders_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "public"."faqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" text,
	"answer" text
);

INSERT INTO "public"."services" ("id", "name", "description", "pricing", "requirements_from_customer") VALUES
(1, 'Media Buying (Facebook & TikTok Boosting)',
'Professional ad campaign management on Facebook and TikTok. We run targeted boost campaigns to grow your page followers, increase engagement, drive messages, or boost video views. Our team analyzes page performance and optimizes audience targeting for the best results.',
'Facebook Boosting:
  5 USD  = 29,000 MMK
  10 USD = 58,000 MMK
  100 USD = 575,000 MMK

TikTok Boosting:
  5 USD  (500 coins)  = 33,000 MMK
  10 USD (1000 coins) = 65,000 MMK
  20 USD (2000 coins) = 129,000 MMK
  30 USD (3000 coins) = 195,000 MMK',
'For Boost Service, please provide:
1. The Post Link or Page Link you want to boost — we will review it first.
2. Post Boost starts from $5 minimum.
3. Page Boost (Page Promote Campaign) starts from $10 minimum.
4. Grant Page Editor access so we can manage campaigns.

Also let us know which campaign objective you want:
- Page Promote — increase followers and organic reach
- Engagement — boost likes, comments, and shares (best for new posts)
- Messages — drive inquiries to your Page Chat Box
- Video Views — maximize viewership (ideal for live sales)

Our team will analyze your page performance and fine-tune audience settings for optimal results.'),

(2, 'Content Writing',
'Professional social media content writing service. We craft engaging copy tailored to your brand voice — delivered within 24 hours. Also available as part of monthly content packages for consistent posting schedules.',
'19,500 MMK per content piece (delivered within 24 hours)',
'To place a content writing order, please provide:
1. Brand / Business Name
2. Business Category / Type
3. Products or Services you are selling
4. Main points or key messages you want highlighted
5. Phone Number
6. Page Link

Payment is prepaid. Content will be delivered within 24 hours.'),

(3, 'Logo & Cover Design',
'Custom logo creation plus a professionally designed Facebook Page cover image that aligns with your brand identity. We create unique, eye-catching designs that make your page stand out. Delivery within 1 week.',
'99,000 MMK (Logo + Cover Design Package)',
'To place a Logo & Cover Design order, please provide:
1. Business Name
2. Business Category
3. Preferred Main Color(s)
4. Preferred Font Style
5. Background Color Preference
6. Reference Logo Designs (if any — for inspiration)

Payment is prepaid. Delivery within 1 week.'),

(4, 'Social Media Design',
'Eye-catching social media post designs optimized for Facebook and other platforms. We create scroll-stopping visuals that match your brand aesthetic and drive engagement. Delivery within 2 days.',
'25,000 MMK per design',
'To place a Social Media Design order, please provide:
1. Page Link
2. Preferred Color Scheme
3. Preferred Font Style
4. Main Headline Text
5. Phone Number & Address (for CTA)
6. Reference Designs (if any — for inspiration)

Payment is prepaid. Delivery within 2 days.'),

(5, 'Motion Video Graphics',
'Professional animated motion graphics to build brand awareness fast. Eye-catching animations with voiceover, text overlays, and call-to-action elements. Perfect for social media ads and brand storytelling.',
'15 sec — 90,000 MMK
20 sec — 120,000 MMK
30 sec — 150,000 MMK
45 sec — 190,000 MMK
1 min  — 210,000 MMK',
'To place a Motion Video order, please provide:
1. Brand Name
2. Business Type
3. Preferred Color(s)
4. Target Audience
5. Narrator Voice — Male or Female
6. Duration — 15 / 20 / 30 / 45 / 60 seconds
7. Aspect Ratio — 1:1 (Square) or 16:9 (Widescreen)
8. Main Content / Key Messages
9. Phone Number & Address (for CTA)
10. Any specific highlights you want emphasized

After client confirmation, delivery time is 3 days. Payment is prepaid.'),

(6, 'Page Create & Setup Service',
'Complete Facebook Page creation and professional setup. We configure your page settings including auto-replies, greeting messages, frequently asked questions (FAQs), profile picture, cover photo, and all essential page information so your business looks credible from day one.',
'25,000 MMK',
'To set up your new Facebook Page, please provide:
1. Page Name
2. Phone Number and Gmail (for page admin)
3. Address (can be approximate / general area)
4. Page Category (e.g. Fashion, Cosmetics, Consumer Goods, Services, etc.)
5. Business Description (2-3 sentences about your business)
6. Instant Reply Message (auto-reply when someone messages your page)

Example instant reply: "Welcome to [Page Name]! Thank you for reaching out. How can we help you today? We will respond as soon as possible. Contact: [Phone Number]"

7. FAQ Auto-Replies (at least 3 Q&A pairs)

Example:
  Q: "I want to order"
  A: "Yes, you can place an order. Please let us know what you would like."

Please send all information in numbered order.'),

(7, 'Account & Page Followers',
'Boost your social proof with follower packages. We offer both Facebook Account followers and Facebook Page followers (Likes/Follows) targeting Myanmar region accounts. Choose between Standard and Professional modes.',
'Facebook Account Followers:
  1,000 Followers = 21,000 MMK (Standard Mode)
  1,000 Followers = 25,500 MMK (Professional Mode)

Facebook Page Followers (Myanmar):
  1,000 Page Likes    = 19,500 MMK (Like Button)
  1,000 Page Follows  = 25,500 MMK (Follow Button)',
'This service provides digital followers — your follower count increases, but these accounts do not actively engage with your content. For real, engaged followers who may become customers, we recommend our Page Promote ad campaign service instead.

For long-term business growth, running paid ad campaigns to attract genuine followers delivers better results than purchasing digital followers.'),

(8, 'Facebook Marketing Online Class',
'Learn how to advertise on Facebook from experienced media buyers. Covers Facebook Ads Manager, campaign objectives, audience targeting, budget optimization, and campaign analysis. Includes recorded video lessons in a private Facebook group plus Q&A support via Messenger. Lifetime access.',
'40,000 MMK (One-time payment — Lifetime Access)',
'No prerequisites. Simply register and you will be added to the private Facebook group with full access to all recorded lessons. You can ask questions anytime via Messenger.'),

(9, 'TikTok Marketing Online Class',
'Master TikTok advertising from scratch. Learn how to set up TikTok ads, run boosting campaigns, create viral video content, and grow your audience. Includes step-by-step recorded tutorials and live Q&A support.',
'99,000 MMK (One-time payment — Lifetime Access)',
'No prerequisites. Suitable for beginners who want to learn TikTok advertising and content strategy. You will receive access to all course materials and direct support for your questions.'),

(10, 'TikTok Boosting Service',
'Boost your TikTok videos to reach more viewers, gain followers, and drive messages. We run targeted TikTok promote campaigns with flexible budgets and duration options.',
'TikTok Boosting:
  5 USD  (500 coins)  = 33,000 MMK
  10 USD (1000 coins) = 65,000 MMK
  15 USD (1500 coins) = 98,000 MMK
  20 USD (2000 coins) = 129,000 MMK
  30 USD (3000 coins) = 195,000 MMK',
'To place a TikTok Boost order, please provide:
1. The Video Link you want to boost.
2. Your preferred campaign objective:
   - More Followers — gain real followers and video views (Recommended — best value, grows both followers and views)
   - More Views — maximize video viewership
   - More Messages — drive inquiries to your inbox (available for Myanmar Region accounts only; non-Myanmar accounts can use More Followers or More Views)

Budget guide:
- 5 USD runs for 1 day (estimated 5,000 - 10,000 views depending on content quality)
- 10 USD runs for 2 days (or 1 day for faster results)
- 20 USD runs for up to 4 days

Actual results vary based on how engaging your video content is.'),

(11, 'Monthly Content Packages',
'All-in-one monthly content and design packages designed to turn brand awareness into sales. Each package includes a set number of content pieces and matching designs delivered throughout the month. Perfect for businesses that want consistent, professional posting without the daily headache of content creation.',
'Starter Package   = 450,000 MMK/month
  • 12 Content Pieces + 12 Designs
  Best for: New pages building a foundation

Standard Package   = 600,000 MMK/month
  • 16 Content Pieces + 16 Designs
  Best for: Growing pages focused on audience connection

Growth Package     = 750,000 MMK/month
  • 20 Content Pieces + 20 Designs
  Best for: Pages ready to drive sales and conversions

Premium Package    = 900,000 MMK/month
  • 24 Content Pieces + 24 Designs
  Best for: Established businesses scaling with a fully managed content system',
'Choose the package based on where your business is now and where you want it to go — not just based on price.

Starter — Perfect if you are just launching your page or want to test professional content with a modest budget. Focus is on consistency and getting noticed.

Standard — For pages ready to build deeper audience connection and trust. More content volume means more touchpoints with potential customers.

Growth — Content shifts from "just posting" to driving sales. Higher volume increases your chances of going viral and converting viewers into buyers.

Premium — Near fully-managed page content. We build your brand while optimizing for sales. Best for serious business owners who view marketing as an investment, not an expense.

Payment is prepaid monthly. Content is delivered on a scheduled calendar throughout the month.'),

(12, 'Blue Mark Verification Service',
'We help you apply for and obtain the Facebook verified blue badge for your account or page. The blue check mark builds instant credibility and trust with your audience. Available for both personal accounts and business pages.',
'300,000 MMK',
'Requirements vary based on your account/page type and notability. We will assess your eligibility and guide you through the application process. Not all applications are guaranteed — verification is ultimately decided by Facebook/Meta.'),
(13, 'Monetization Setup Service',
'We help you set up and qualify for content monetization on Facebook and TikTok. This includes meeting platform requirements, setting up payment accounts, and optimizing your content strategy for revenue generation. We charge a commission only on the revenue you earn.',
'10% commission on revenue generated through monetization (no upfront fee)',
'Requirements:
1. Your page or account must meet the platform''s minimum eligibility criteria for monetization (e.g. follower count, video views, content guidelines).
2. We will assess your account and advise on any gaps before proceeding.
3. Commission is calculated and invoiced monthly based on verified earnings.

Note: Monetization approval is subject to each platform''s policies and review process.'),

(14, 'Video Production',
'Professional video production for your brand — from smartphone-quality social content to cinematic camera productions. We handle everything: concept, filming, editing, motion subtitles, and color grading.',
'Starter Package (Shot on iPhone) — 300,000 MMK
  • 1 High-Impact Video
  • Shot on high-resolution smartphone with lighting
  • Approx. 60-90 seconds
  • Standard editing with motion subtitles
  • Standard color grade
  • Single location, single day shoot
  Ideal for: New businesses and budget-conscious brands who want creative, quality content

Standard Package (Shot on iPhone) — 675,000 MMK
  • 4 Fully Edited Videos
  • Shot on high-resolution smartphone
  • 1 to 2.5 minutes per video
  • Editing optimized for current social media trends
  • Basic color enhancement
  • Single location, single day shoot
  Ideal for: Brands wanting consistent content volume with trend-aware editing

Growth Package (Professional Camera) — 525,000 MMK
  • 1 High-Impact Video
  • Shot on professional camera with lighting
  • Approx. 60-90 seconds
  • Standard editing with motion subtitles
  • Standard color grade
  • Single location, single day shoot
  Ideal for: Brands ready for cinematic quality on a focused single-video project

Premium Package (Professional Camera) — 825,000 MMK
  • 4 Fully Edited Videos
  • Shot on professional camera with lighting
  • 1 to 2 minutes per video
  • Trendy, high-energy social media optimized editing
  • Professional color correction & grading
  • Single location, single day shoot
  Ideal for: Established brands wanting premium cinematic content at volume',
'Please share:
1. Brand Name
2. Business Type / Industry
3. Video Purpose (brand awareness, product showcase, sales promo, etc.)
4. Preferred Package
5. Preferred Shooting Location
6. Any specific creative direction or reference videos you like

Our team will coordinate the shoot schedule after confirmation. Additional locations or shoot days are available at extra cost — please inquire for a custom quote.'),

(15, 'In-Person Consultation',
'Sit down with our senior marketers (5+ years of experience) for a personalized strategy session. We analyze your current social media presence, identify growth opportunities, and build a customized action plan to scale your business through digital marketing.',
'100,000 MMK per session (1-2 hours)',
'Our office is located in North Dagon, Yangon. Please book at least 1 day in advance. During the session we will:
1. Review your current social media pages and ad accounts
2. Analyze past campaign performance (if applicable)
3. Identify growth opportunities specific to your business
4. Provide a written action plan with recommended next steps

Bring your page admin access credentials and any campaign data you''d like us to review.');

INSERT INTO "public"."payment_methods" ("id", "name", "account_name", "account_number", "note") VALUES
(1, 'Kpay', 'Aung Myat Min', '09123456789', 'Primary payment method. Most convenient for Myanmar users.'),
(2, 'UAB Pay', 'Thazin Hlaing', '09987654321', 'Alternative bank transfer option.'),
(3, 'Wave Pay', 'Thazin Hlaing', '09987654321', 'Mobile wallet — instant transfers.'),
(4, 'AYA Pay', 'Thazin Hlaing', '09987654321', 'AYA Bank mobile payment. Please include your page name in the transfer note.');

INSERT INTO "public"."faqs" ("id", "question", "answer") VALUES
(1, 'I need advice on where to start with advertising', 'If your page is new, we recommend starting with a Page Promote campaign to build a solid follower base first. This improves organic reach on all your future posts. You can start from just $10.

If your page already has followers, we still recommend running Page Promote at least twice a month to maintain steady growth.

For new sales posts, since reactions and comments are still low, we suggest running both an Engagement campaign and a Message campaign together — this maximizes visibility and inquiries.'),

(2, 'I''m not getting any messages or inquiries', 'Low messages can happen for several reasons:
- Low page followers reduce customer trust — people visit your page, see low numbers, and hesitate to contact you.
- New posts with few reactions get lower impressions, so fewer people see them.
- Content may not be attention-grabbing enough — the visuals and copy might need to be reworked to attract interest.
- Audience targeting may need adjustment — our Better Solutions team can review your campaign results and fine-tune the audience settings for better performance.'),

(3, 'I''m not getting any orders', 'Low or no orders can happen for several reasons:
- Low page followers reduce customer trust — people browse but don''t feel confident buying.
- New posts with few reactions get lower impressions, meaning fewer people see your offers.
- Content quality may not be compelling enough — visuals and copy might need a refresh to capture interest.
- Audience targeting may need adjustment — our team can review your campaign results and edit the audience settings for better conversions.'),

(4, 'How do I get real followers?', 'To get genuine, real followers, run a Page Promote campaign. The benefit is that people who are genuinely interested in your business will follow your page — these are potential future customers. Plus, your organic reach on future posts will improve because you have a real audience base.'),

(5, 'How do I get more sales?', 'For driving sales, we recommend running a Message campaign objective. However, there are a few prerequisites:
1. Your ad post content quality must be compelling — this is the number one factor.
2. Your page needs enough followers for social proof — if a potential customer visits your page and sees very few followers, trust drops and they may not buy. Run Page Promote first if your follower count is low.
3. For new sales posts, run Engagement + Message campaigns together for best results.'),

(6, 'How much budget should I start with?', 'We recommend starting with $10 for Engagement + $10 for Message — a total of around $20 to see meaningful results. Start there, review performance, then increase budget and duration once you confirm it is working well for your business.'),

(7, 'I can''t afford a large budget right now', 'No problem — you can start with just $10 and test the waters. Once you see results and feel comfortable, you can increase the budget gradually. The key is to start and gather data, then scale what works.'),

(8, 'Why am I not making sales?', 'Several factors could be at play:
- Low page followers reduce customer trust — people browse but don''t buy.
- New posts with few reactions get lower impressions and fewer messages.
- Content may not be attractive enough — visuals and copy might need improvement.
- Audience targeting may need adjustment — our team can review your campaign and refine the audience settings.'),

(9, 'Can you adjust my audience targeting?', 'Absolutely. We can review and fine-tune your audience targeting settings to improve campaign performance. Just let us know and we will analyze your current setup and make adjustments.'),

(10, 'Can you help boost my orders?', 'Yes. We will run Message Objective campaigns to drive inquiries and orders. Our Better Solutions team will carefully manage the campaign to maximize your conversions.'),

(11, 'I''m just starting a new page', 'We offer a Page Create & Setup Service for only 25,000 MMK. We will create your page, set up all settings including profile picture, cover photo, auto-replies, greeting messages, and FAQs — so your page looks professional and credible from day one.'),

(12, 'How many days will you run a $10 boost?', 'For $10, we typically run 3-4 days. While you can stretch it to $1 per day for 10 days, daily ad delivery becomes too thin and results won''t be as effective. We recommend concentrating the budget over fewer days for better impact.'),

(13, 'Can I buy followers?', 'Yes, you can purchase digital followers starting from 1,000. These are Myanmar region accounts. However, digital followers only increase your count — they do not engage with your content or become customers.

For long-term business growth, we strongly recommend running Page Promote campaigns with real ad spend to attract genuine followers who are actually interested in your business.'),

(14, 'Can you check my campaign results?', 'Of course. Let me look into your campaign and I will get back to you shortly. Please wait a moment.'),

(15, 'Is my boost active yet?', 'Let me check for you. One moment please.'),

(16, 'Is there still dollar balance left on my campaign?', 'Let me check your remaining balance. One moment please.'),

(17, 'Tell me about Live Sale Boosting', 'Our Live Sale Boosting service starts from $10. You need to notify us at least 1 hour before your live sale starts. We will boost your live stream to attract real, interested viewers.

With around $10 spend, you can expect hundreds of additional live viewers depending on how engaging your content is. We cannot guarantee exact numbers, but you will see significantly more viewers than going live without boosting.'),

(18, 'How many days for a $5 boost?', 'For $5, we typically run 1-2 days. While you can stretch it to $1 per day for 5 days, daily delivery becomes too thin and results suffer. We recommend running $5 over 1-2 days for more noticeable impact. For even better results, $10 over 2-3 days is ideal.'),

(19, 'How do I grant page admin access?', 'For boost services, you do NOT need to grant Full Permission Admin access. Granting Editor Role is sufficient — this lets us switch into your page, analyze performance, and optimize campaign results without full control over your page.

If you need a tutorial, we can send you a video showing exactly how to add someone as an Editor. The key step: when adding a new person in Page Access settings, do NOT toggle on Full Permission — that keeps them as an Editor.'),

(20, 'Can I have your phone number?', 'You can reach us at 09777888999 for any inquiries.'),

(21, 'Where is your office located?', 'Our office is in North Dagon, Yangon. If you would like an in-person consultation, please book at least one day in advance.'),

(22, 'Tell me about your packages', 'We offer two types of packages:

**Monthly Content Packages** — For business owners tired of figuring out what to post every day. We create a strategic content calendar with professional copy and designs delivered throughout the month.

Posting on your page isn''t just about creating content — it''s about building a system that attracts potential customers.

Starter (450,000 MMK): 12 content + 12 designs — perfect for new pages building a foundation. Most important thing at this stage is consistency, not perfection.

Standard (600,000 MMK): 16 content + 16 designs — shifts focus from just posting to building audience connection and trust.

Growth (750,000 MMK): 20 content + 20 designs — content becomes sales-oriented. Higher volume increases both viral potential and conversion rates.

Premium (900,000 MMK): 24 content + 24 designs — near fully-managed page. We build your brand while optimizing for sales. At this level, your marketing budget should be viewed as an investment, not an expense.

**Video Production Packages** — Professional video production ranging from smartphone-shot social content to cinematic camera productions. See our Video Production service for full details.

When choosing a package, focus on what level you want your business to reach — not just the price tag.'),

(23, 'I want to advertise on TikTok', 'Yes, we can help. Do you already have a TikTok account?

If not, we can create one for you:
- Myanmar Region Account: 25,000 MMK
- Japan Region Account: 35,000 MMK

Myanmar Region is recommended for businesses targeting Myanmar audiences with Message campaigns — it works better for advertising.

Japan Region accounts are primarily for monetization purposes (earning from views). Message campaign objectives don''t work well on Japan region accounts.

If you already have a TikTok account, simply send us the video link you want to boost and we will review it.'),

(24, 'Can you create a TikTok account for me?', 'Yes, we can create TikTok accounts:
- Myanmar Region Account: 25,000 MMK
- Japan Region Account: 35,000 MMK

Choose Myanmar Region if you are targeting Myanmar audiences and plan to run Message campaign ads.

Choose Japan Region if your goal is monetization (earning from views). Note that Message campaign objectives are not available for Japan region accounts.

We recommend Myanmar Region for most businesses as it works better for advertising.'),

(25, 'What are the TikTok boosting prices?', 'TikTok Coin pricing:
  5 USD  (500 coins)  = 33,000 MMK
  10 USD (1000 coins) = 65,000 MMK
  15 USD (1500 coins) = 98,000 MMK
  20 USD (2000 coins) = 129,000 MMK
  30 USD (3000 coins) = 195,000 MMK

500 coins equals $5 USD. With $5 we run your ad for 1 day and you can expect approximately 5,000 to 10,000 views depending on how engaging your video content is. Actual results vary based on content appeal.'),

(26, 'Can you target specific locations for TikTok boosting?', 'Yes, we can target specific locations including Myanmar. We will set your preferred location targeting when running the boost campaign.'),

(27, 'My dollar hasn''t been deducted yet', 'Let me check on that for you. Please wait a moment.'),

(28, 'Are my campaign results good?', 'Let me review your campaign performance and get back to you. One moment please.'),

(29, 'My results are not good', 'Poor results can stem from several factors:
- Low page followers reduce customer trust — people browse but hesitate to engage.
- New posts with few reactions get lower impressions and fewer messages.
- Content may not be attention-grabbing enough — visuals and copy might need a refresh.
- Audience targeting may need adjustment — our team can review your campaign results and refine the audience settings for better performance.'),

(30, 'Can you adjust the audience targeting?', 'Yes, we can fine-tune your audience targeting for better results. Let me review and make adjustments.'),

(31, 'Is payment after the campaign is active?', 'We operate on a prepaid system. Once payment is received, we activate your boost within 1 hour.

If prepayment is difficult for you, we can activate the campaign first, but payment must be made within 1 hour of activation. If payment is delayed beyond 1 hour, we will pause the campaign.

We recommend prepayment for a smoother experience. You can also check our page reviews and feedback from past clients for peace of mind.'),

(32, 'Does Page Promote bring real followers?', 'Yes, Page Promote campaigns bring genuine, real followers. The benefit is that people who are actually interested in your business will follow your page — these are potential future customers. Additionally, future posts will benefit from improved organic reach because you have a real audience.'),

(33, 'Can I change my page name?', 'Whether a page name can be changed depends on the page itself. We need to check your specific page to determine if a name change is possible. Let us review it for you.'),

(34, 'My page has been around for a while — where should I start?', 'If your page has been around but inactive, we recommend starting with a Page Promote campaign to build or refresh your follower base. This improves organic reach on all future posts. You can start from $10.

Even if you already have some followers, running Page Promote at least twice a month helps maintain steady growth.

When you are ready to boost a new post, run Engagement + Message campaigns together since reactions and shares are likely still low — this combination maximizes both visibility and inquiries.'),

(35, 'What information do you need to create my page?', 'To set up your page, please provide the following numbered information:

1. Page Name
2. Phone Number and Gmail
3. Address (can be approximate, we can customize this)
4. Page Category (type of business: Fashion, Cosmetics, Consumer Goods, Services, etc.)
5. Business Description (brief summary of what you do)

Example: "We sell affordable cosmetics and beauty products" or "We provide [type of service]"

6. Instant Reply Message (auto-reply when someone messages your page)

Example: "Welcome to [Page Name]! How can we help you? We will respond as soon as possible. Contact: [Phone Number]"

7. FAQ Auto-Replies — at least 3 Q&A pairs

Example:
  Q: "I want to place an order"
  A: "Yes, you can place an order now."

Please send all details in numbered order.'),

(36, 'Can you target specific townships for post boosting?', 'Yes, you can. We can set targeting to any specific location or township you want your ads to reach.'),

(37, 'How many followers can I expect from $5 on TikTok More Followers?', 'With $5 on TikTok''s More Followers objective, you can expect approximately 300 to 1,000 new followers. Results vary based on how engaging your video content is.'),

(38, 'Do you offer refunds if I''m not happy with the results?', 'Yes. If you are not satisfied, we will calculate the remaining balance and refund the unused portion to you.'),

(39, 'Do you have a service for Facebook account login issues?', 'We have a Facebook Error Fix service available. Please reach out with details about your issue.'),

(40, 'How much should I spend to grow page followers quickly?', 'Start with $10 (58,000 MMK). Once you see good results, then increase your budget. We recommend testing first and scaling what works rather than spending heavily upfront.'),

(41, 'What should I do after creating my page?', 'After creating your page, run a Page Promote campaign first to build followers. Once you have a solid follower base, then start running sales posts with message/engagement campaigns. Don''t rush to sell before you have an audience.'),

(42, 'Can I buy an existing page with followers?', 'We only create new pages. Existing pages with followers cannot be transferred or purchased from us.'),

(43, 'Do you offer blue mark verification service?', 'Yes, we offer blue mark verification for both Facebook Accounts and Facebook Pages. Please inquire for details and eligibility assessment.'),

(44, 'When can I remove page admin access after my campaign?', 'You can remove admin/editor access once your campaign is completed. If you plan to continue advertising with us, feel free to keep our access — it allows us to monitor performance and optimize future campaigns.'),

(45, 'Can you give me a discount on the exchange rate?', 'Our rate is 5,800 MMK per USD for regular orders. For orders of $100 or more, we can offer 5,700 MMK per USD.'),

(46, 'Why is your exchange rate 5,800 when the bank rate is lower?', 'The rate includes our service fee for campaign management, audience optimization, performance analysis, and ongoing adjustments. You are paying for professional media buying, not just the ad spend.'),

(47, 'Can I try with just $2?', 'Our minimum order is $5. This is the minimum required to run any meaningful ad campaign that produces measurable results.'),

(48, 'Can I still post normally while a Page Promote is running?', 'Yes — and it is actually beneficial. While the Page Promote campaign is active, more people are visiting your page, so your regular posts will get more visibility too. Keep posting as usual.'),

(49, 'Will my Page Promote ad appear on my page wall?', 'No. Page Promote campaigns run as Dark Posts — they deliver behind the scenes to attract followers without appearing on your page wall. However, you will see follower count increases and follow notifications coming in, so you know it is working.'),

(50, 'Is it active?', 'Let me check for you now.'),

(51, 'Can I do $5 for 2 days on TikTok?', 'TikTok $5 runs for 1 day only. For longer duration, you would need to increase the budget (e.g. $10 for 2 days).'),

(52, 'Can you write content for my posts?', 'Yes, we offer Content Writing at 19,000 MMK per piece. Delivered within 24 hours.'),

(53, 'Why do results vary from month to month with Page Promote?', 'Campaign results can vary month to month due to several factors: changes in audience behavior, seasonal trends, ad fatigue from using the same creative, increased competition in your category, or shifts in platform algorithms. We continuously monitor and adjust targeting to maintain consistent performance. If results drop noticeably, we will review and optimize your campaign setup.'),

(54, 'Do I need to grant admin access for post boosting too?', 'For boost services, you only need to grant Editor Role access — Full Permission Admin is not required.

When adding someone in Page Access settings, simply do NOT toggle on Full Permission — this keeps them as an Editor. An Editor can switch into your page, analyze performance, and optimize campaign results without having full control.

We can send you a tutorial video showing exactly how to do this.'),

(55, 'Send me the account link for admin access', 'Of course. I will send you the ad account link now. One moment please.'),

(56, 'What do I need to provide for a Page Promote order?', 'To start a Page Promote campaign, please provide:

1. Photos: 4 or 8 photos for your business (including your logo). These will be used in the promote ad creative.
2. Short ad copy with a clear CTA (Call to Action) — urging people to follow your page.

Example (for a clothing page):
"Stay stylish with our wide range of quality fashion designs at affordable prices — both retail and wholesale available. Follow our page now!"

Don''t worry if you are not confident writing the copy — our team can write it for you. Just send us the key points about your business.

Important Terms & Conditions:
- Campaign results can only be viewed from our ad account side (because campaigns are run via Facebook Web using lifetime budgets).
- You will see Page Like notifications and follower count increases on your end.
- Page Promote campaigns run as Dark Posts — they do not appear on your page wall. They work behind the scenes to attract followers.
- For $10 (58,000 MMK), you can typically expect 200 to 1,000+ new real followers depending on how engaging your creative is. Since these are real people genuinely interested in your business, exact numbers cannot be guaranteed.

These details are shared upfront so you know exactly what to expect.'),

(57, 'How many days should I run my campaign for best results?', 'For noticeable results: $10 should run for 2 days, $5 should run for 1 day. Concentrating your budget over fewer days delivers stronger daily impressions and better outcomes than stretching it thin over many days.'),

(58, 'What are the Motion Video prices?', 'Motion Video pricing:
  15 sec — 90,000 MMK
  20 sec — 120,000 MMK
  30 sec — 150,000 MMK
  45 sec — 190,000 MMK
  1 min  — 210,000 MMK

To place an order, please provide: Brand Name, Business Type, Preferred Colors, Target Audience, Narrator Voice (Male/Female), Duration, Aspect Ratio (1:1 or 16:9), Main Content/Key Messages, and Phone & Address for CTA.

Delivery time is 3 days after client confirmation.'),

(59, 'How long should a Page Promote run for?', 'We typically recommend 2-3 days per $10 for Page Promote campaigns. Shorter, concentrated runs tend to deliver stronger results than spreading the budget too thin. For $5, 1 day is standard. You can discuss your specific goals with our team to find the ideal duration for your campaign.'),

(60, 'Do you offer content writing?', 'Yes, we provide content writing at 19,000 MMK per piece. Delivery within 24 hours.'),

(61, 'What info do you need for content writing?', 'To place a content writing order, please provide:
1. Brand Name
2. Business Type
3. Your USP / Key Selling Point
4. Target Audience
5. Page Link
6. Phone & Address (for CTA)
7. More Details / Key Messages
8. Any specific highlights or angles you want emphasized'),

(62, 'I want to increase my campaign budget', 'Absolutely. Just let me know how much you would like to add to your budget and we will top it up.'),

(63, 'Can you explain your Boost Service?', 'Our Boost Service covers Facebook and TikTok ad campaign management. We handle everything: campaign setup, audience targeting, budget optimization, and performance monitoring. You provide the post or page link, choose your objective (Page Promote, Engagement, Messages, or Video Views), and we run the campaign professionally. Minimum budget starts at $5.'),

(64, 'What are the benefits of running an Engagement campaign?', 'Engagement campaigns boost likes, comments, and shares on your posts. This increases your post''s visibility (impressions), builds social proof, and signals to the algorithm that your content is valuable — leading to even more organic reach. Best used for new posts that need initial traction.'),

(65, 'I want to run an Engagement campaign', 'Got it. Please send us the post link you want to boost and we will set up an Engagement campaign to drive likes, comments, and shares. This will increase your post''s reach and visibility.'),

(66, 'I want to run a Message campaign', 'Perfect. Send us the post link and we will set up a Message campaign to drive inquiries to your page inbox. This is the best objective for generating sales leads.'),

(67, 'I want to run a Video View campaign', 'Great. Share the video link and we will set up a Video View campaign to maximize viewership. This is ideal for brand awareness, product showcases, and live sales.'),

(68, 'Does TikTok boost boost individual posts or the whole page?', 'TikTok boosting works on individual video posts. Each boost campaign is linked to a specific video you want to promote. It is not a page-level boost like Facebook Page Promote.'),

(69, 'How many followers do I need for TikTok monetization?', 'TikTok monetization requirements vary by region and program. Generally, you need at least 1,000-10,000 followers depending on the specific monetization feature. Contact us for the latest requirements for your region.'),

(70, 'How many video views do I need for TikTok monetization?', 'Requirements vary but typically you need a minimum number of video views in the last 30 days in addition to follower thresholds. We can check the current TikTok monetization criteria for your account — reach out for an assessment.'),

(71, 'Can I edit a post while it is being boosted?', 'Editing a post while a boost is active is not recommended. Changes to the post content, image, or link can disrupt the campaign delivery and may cause the boost to be re-reviewed by the platform, causing delays. It is best to finalize your post content before starting the boost.'),

(72, 'Why do I need to grant page access? Can I just give Editor role?', 'Editor role is exactly what we need — you do NOT need to grant Full Admin access. Editor role allows us to switch into your page, view performance analytics, and optimize campaign settings. This is sufficient for all our boost and management services. Full Admin is never required.'),

(73, 'Is that Kpay number correct? 09123456789', 'Yes, that is our Kpay number. You can transfer to 09123456789 (Account Name: Aung Myat Min).'),

(74, 'What is your Kpay number?', 'Kpay: 09123456789 — Account Name: Aung Myat Min'),

(75, 'What is your Wave Pay number?', 'Wave Pay: 09987654321 — Account Name: Thazin Hlaing'),

(76, 'I want to do Post Boost', 'Sure. Please send us the post link you want to boost and let us know your preferred campaign objective (Engagement, Messages, or Video Views).'),

(77, 'I want to do Page Boost', 'Of course. We can run a Page Promote campaign to increase your followers and improve organic reach. Starting from $10. Let us know your budget and we will get started.'),

(78, 'Do you have online classes available?', 'Yes, we offer two online classes:
1. Facebook Advertising Class — covers media buying, campaign management, and optimization (40,000 MMK, lifetime access)
2. TikTok Advertising Class — covers TikTok boosting, viral content strategy, and platform advertising (99,000 MMK, lifetime access)

Both include recorded video lessons and Messenger Q&A support.'),

(79, 'I want to join the TikTok online class', 'Great! The TikTok Advertising Class is 99,000 MMK for lifetime access. You will learn how to set up and run TikTok ads, create viral content, and grow your audience. We will add you to the private learning group after registration.'),

(80, 'I want to join the Facebook online class', 'Excellent choice. The Facebook Advertising Class is 40,000 MMK for lifetime access. You will learn media buying, campaign setup, audience targeting, and performance analysis. We will add you to the private Facebook group with all recorded lessons.'),

(81, 'I am asking about my current boosted post', 'Understood. Let me review your campaign results carefully and I will give you a detailed update. One moment please.'),

(82, 'I am asking about my active boost', 'Got it. Let me check your active campaign status and results. Please wait a moment.'),

(83, 'Are these auto-replies?', 'Yes, I am Better Solutions''s AI Digital Assistant. I''m here to help answer your questions quickly so you don''t have to wait. If you prefer to speak with a human, I can connect you to our Admin Team.'),

(84, 'Is this a bot?', 'Yes, I am Better Solutions''s AI Digital Assistant. I provide instant answers to common questions so you don''t have to wait. If you would prefer to speak with a real person, I can connect you to our Admin Team right away.'),

(85, 'Please connect me to a human', 'Of course. Please wait a moment while I connect you with our Admin Team.'),

(86, 'Can I do TikTok advertising?', 'Yes, we offer full TikTok advertising services. Do you already have a TikTok account?

If not, we can create one: Myanmar Region (25,000 MMK, recommended for advertising to Myanmar audiences) or Japan Region (35,000 MMK, for monetization purposes).

If you already have an account, just send us the video link you want to boost and we will take care of the rest.'),

(87, 'Why does my TikTok boost get copyright issues?', 'Copyright flags typically occur when the video was previously uploaded on another platform and is being re-uploaded to TikTok. The system detects duplicate content. We recommend using original content created specifically for TikTok to avoid copyright issues.'),

(88, 'Are bought followers real or fake?', 'Purchased followers are digital followers — they increase your follower count number but do not actively engage with your content. They do not provide real business value beyond the appearance of a higher count.

For real, engaged followers who may become customers, we strongly recommend running Page Promote ad campaigns instead.'),

(89, 'How do I get real page followers?', 'Run a Page Promote campaign to attract genuine followers. These are real people who are interested in your business and may become future customers. Your organic reach on future posts will also improve.'),

(90, 'Can I buy TikTok followers?', 'Yes, TikTok followers are available for purchase. Contact us for current pricing.'),

(91, 'Do you have packages for TikTok?', 'We do not have a dedicated TikTok monthly content package yet. However, we offer TikTok account creation, TikTok boosting services, and Video Production packages that work great for TikTok content. We can help you from account setup through to professional video production.'),

(92, 'I am not getting any orders yet', 'Let me review and adjust your audience targeting. There is still remaining campaign budget, so more orders could still come in. Monitor for a bit — sometimes campaigns need a few days to optimize. If needed, our team can edit the audience settings to improve results.'),

(93, 'I haven''t made any sales yet', 'Let me review your audience targeting and make adjustments. Your campaign still has remaining budget, so sales could still come through. Campaigns sometimes take 2-3 days to fully optimize. Our team can refine the audience settings to improve conversion rates.'),

(94, 'What is the minimum budget for Facebook ads?', 'You can start from as low as $5 (29,000 MMK). This is the minimum required to run a Facebook ad campaign with measurable results.'),

(95, 'My follower count is still too low', 'We recommend running a Page Promote campaign to attract genuine, real followers. This will build your audience base and improve the credibility of your page.'),

(96, 'My follower growth is slow', 'Let me check your campaign status. If there is remaining budget, more followers will come as the campaign continues to deliver. Sometimes growth is gradual — consistency is key.'),

(97, 'Do you guarantee a minimum number of followers from Page Promote?', 'Because we deliver real, organic followers (not fake accounts), exact numbers cannot be guaranteed. Results depend on your ad creative quality, targeting accuracy, and audience response. Based on past campaigns, $10 typically generates 200-1,000+ new followers. If results are significantly below expectations, our team will review and adjust your campaign setup.'),

(98, 'After TikTok monetization is approved, do you help with bank linking?', 'Yes, we can assist with linking your bank account for TikTok monetization payouts. Contact us once your monetization is approved and we will guide you through the bank setup process.'),

(99, 'I am trying to add admin but friend request is not working', 'This can happen if the account you are trying to add has privacy restrictions or if you are using the wrong method. Instead of sending a friend request, use the Page Access settings to add people by their account link or email. We can send you a step-by-step video guide — just ask.'),

(100, 'Why do I need to add page admin? Can I skip this step?', 'For boost services, granting Editor access (not Full Admin) is necessary so we can switch into your page, view performance analytics, and optimize campaign settings. Without it, we cannot manage your campaigns effectively. You only need to grant Editor role — Full Admin is never required.'),

(101, 'For TikTok boost, do I need to grant admin access too?', 'No. TikTok boosting does not require page or account admin access. You simply need to send us the video link you want to boost and we handle the rest from our advertising account.'),

(102, 'What is the difference between Japan and Myanmar TikTok regions?', 'Myanmar Region accounts are best for advertising to Myanmar audiences. All campaign objectives including Messages work well. Recommended for businesses targeting local customers.

Japan Region accounts are created for monetization purposes (earning revenue from video views). Message campaign objectives do not work on Japan region accounts. Best if your goal is content monetization rather than direct advertising.

We recommend Myanmar Region accounts for most businesses.'),

(103, 'How much for a logo design?', 'Our Logo & Cover Design package is 99,000 MMK, which includes a custom logo plus a professionally designed Facebook page cover. Delivery within 1 week. We will ask for your business name, category, preferred colors, font style, and reference designs.'),

(104, 'How much for a cover photo design?', 'Our Logo & Cover Design package (99,000 MMK) includes both the logo and page cover together. For cover-only design, we can provide a custom quote — please reach out with your requirements.'),

(105, 'How much for logo and cover together?', 'The Logo & Cover Design package is 99,000 MMK for both — a custom logo plus a professionally designed Facebook page cover image. This is our recommended package for new pages that need a complete visual identity.'),

(106, 'How can I grow my TikTok followers?', 'For organic TikTok follower growth, focus on: posting consistently (daily if possible), using trending sounds and hashtags, creating engaging content that encourages shares, and interacting with your audience. For faster growth, you can run TikTok boosting campaigns with the More Followers objective — or purchase followers for instant count increase (though these will not engage with your content). We recommend a combination of quality content and strategic boosting for the best results.');