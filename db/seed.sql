-- Yummy or Not — seed data.
-- Creates a demo account and 8 sample tastes owned by it, so a fresh clone has
-- something to log into. Demo login (dev only):
--   email:    demo@yummy.test   password: demo1234
--   phone:    +8613800138000    (use the dev OTP printed by /api/auth/otp/request)

-- Demo user. password_hash is scrypt("demo1234") in the app's "salt:hash" format.
INSERT INTO users (id, display_name, phone, email, password_hash, locale, plan) VALUES
  ('demo-user', 'Mina Park', '+8613800138000', 'demo@yummy.test',
   '5e5d9ef8e689fe7588c401f58a6946ee:92399f0c596e9cc451f5549adbf2bdca86e3a08cd899bac20a73f1f6900cc077207aabf52f81b54203d3b3d173b048553c49d249f6fbd01a2c6d1901caec96bd',
   'zh', 'free')
ON CONFLICT (id) DO UPDATE SET
  display_name  = EXCLUDED.display_name,
  phone         = EXCLUDED.phone,
  email         = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  locale        = EXCLUDED.locale,
  plan          = EXCLUDED.plan;

-- Sample tastes (owned by the demo user). created_at staggered for newest-first.
INSERT INTO tastes (id, user_id, name, place, price, verdict, tags, bought_count, notes, image, created_at) VALUES
  ('burger',  'demo-user', 'Double smash burger',   'Shake Shack',          '$9.40',  'yum', ARRAY['Burger','Savory'],  4, 'Reliable. Crispy edges every time.',                                  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80', now() - interval '1 day'),
  ('pizza',   'demo-user', 'Margherita slice',      'Pizzeria Luca',        '$4.50',  'yum', ARRAY['Pizza','Savory'],   5, 'Thin, blistered, simple. My default lunch.',                          'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&q=80', now() - interval '4 days'),
  ('ramen',   'demo-user', 'Tonkotsu ramen',        'Ippudo · Gangnam',     '$14.00', 'yum', ARRAY['Ramen','Savory'],   2, 'Broth is rich without being heavy. Ask for extra noodles.',           'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600&q=80', now() - interval '5 days'),
  ('cake',    'demo-user', 'Basque cheesecake',     'Maison · Itaewon',     '$7.00',  'yum', ARRAY['Dessert','Sweet'],  2, 'Burnt top, custardy middle. Worth every won.',                        'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&q=80', now() - interval '7 days'),
  ('boba',    'demo-user', 'Brown sugar boba',      'Tiger Sugar · Hongdae','$5.80',  'yum', ARRAY['Boba','Sweet'],     3, 'The chewy pearls are unreal. A little too sweet if it sits — drink it fast.', 'https://images.unsplash.com/photo-1558857563-b371033873b8?w=600&q=80', now() - interval '14 days'),
  ('donut',   'demo-user', 'Old-fashioned donut',   'Randy''s · downtown',  '$3.25',  'meh', ARRAY['Dessert'],          1, 'Dry. The glaze is good but the cake part is forgettable.',             'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=600&q=80', now() - interval '21 days'),
  ('tacos',   'demo-user', 'Al pastor tacos',       'El Pino truck',        '$8.00',  'meh', ARRAY['Tacos','Spicy'],    1, 'Fine, but the tortillas fell apart. Salsa was great though.',         'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80', now() - interval '60 days'),
  ('matcha',  'demo-user', 'Iced matcha latte',     'Blue Bottle',          '$6.50',  'nah', ARRAY['Coffee','Matcha'],  1, 'Way too bitter and watery for the price. Not again.',                 'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?w=600&q=80', now() - interval '30 days')
ON CONFLICT (id) DO UPDATE SET
  user_id      = EXCLUDED.user_id,
  name         = EXCLUDED.name,
  place        = EXCLUDED.place,
  price        = EXCLUDED.price,
  verdict      = EXCLUDED.verdict,
  tags         = EXCLUDED.tags,
  bought_count = EXCLUDED.bought_count,
  notes        = EXCLUDED.notes,
  image        = EXCLUDED.image,
  created_at   = EXCLUDED.created_at;
