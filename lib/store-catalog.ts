import { PRODUCTS } from '@/lib/dashboard-data';

export const STORE_CATEGORIES = ['All drinkware', 'Insulated', 'Sport', 'Coffee & cups'] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number];

export type StoreProduct = {
  id: string;
  name: string;
  category: Exclude<StoreCategory, 'All drinkware'>;
  size: string;
  priceCents: number;
  image: string;
  description: string;
  use: string;
};

const [insulated, sport, travel] = PRODUCTS;

export const STORE_PRODUCTS: StoreProduct[] = [
  {
    id: insulated.id,
    name: insulated.name,
    category: 'Insulated',
    size: '32 oz',
    priceCents: 3400,
    image: insulated.image,
    description: 'A generous insulated bottle for the days that take you from your desk to the train and out again. An easy first pick if you like to refill less often.',
    use: 'Long workdays and everyday travel',
  },
  {
    id: sport.id,
    name: sport.name,
    category: 'Sport',
    size: '24 oz',
    priceCents: 1800,
    image: sport.image,
    description: 'A straightforward water bottle for gym sessions, bike rides and walks. The mid-size capacity balances a useful refill with a shape that is easy to carry.',
    use: 'Training, cycling and short outings',
  },
  {
    id: travel.id,
    name: travel.name,
    category: 'Coffee & cups',
    size: '350 mL',
    priceCents: 2400,
    image: travel.image,
    description: 'A compact cup for your first coffee or an afternoon tea. Sized for a single serving when you want something smaller than a full travel mug.',
    use: 'Coffee stops and short commutes',
  },
  {
    id: 'everyday',
    name: 'Everyday Bottle',
    category: 'Insulated',
    size: '20 oz',
    priceCents: 2800,
    image: '/images/store/everyday.webp',
    description: 'A smaller everyday bottle for the space next to your laptop or notebook. Choose it when pack space matters more than maximum capacity.',
    use: 'Desk refills and smaller bags',
  },
  {
    id: 'tumbler',
    name: 'Studio Tumbler',
    category: 'Coffee & cups',
    size: '16 oz',
    priceCents: 2800,
    image: '/images/store/tumbler.webp',
    description: 'A roomy tumbler for iced coffee, tea or water between meetings. A practical middle ground between the compact Travel Cup and a full-size bottle.',
    use: 'Desk drinks and longer coffee breaks',
  },
  {
    id: 'trail',
    name: 'Trail Bottle',
    category: 'Insulated',
    size: '40 oz',
    priceCents: 3900,
    image: '/images/store/trail.webp',
    description: 'Our largest planned bottle, for the days when the next refill is a little farther away. Pick it for capacity on long outings and road trips.',
    use: 'Trail days and road trips',
  },
];

const priceFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const storePrice = (cents: number) => priceFormat.format(cents / 100);
