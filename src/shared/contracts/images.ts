import { z } from 'zod';
import { Binary, endpoint, Upload } from '../contract.js';

export const ImageSource = z.enum(['custom', 'imported', 'none']);
export type ImageSource = z.infer<typeof ImageSource>;

const Image = z.object({ name: z.string(), source: ImageSource });

export const imagesContract = {
  /** The best image for a unit: an uploaded one, else the imported one. `kind` is hero, enemy, phantimal, boss or artifact. */
  portrait: endpoint({ method: 'GET', path: '/api/portrait/:kind/:name', response: Binary }),
  list: endpoint({ method: 'GET', path: '/api/images/:kind', response: z.array(Image) }),
  /** Keeps an uploaded PNG, JPEG, WebP or GIF (at most 2 MB) for a unit. */
  upload: endpoint({ method: 'PUT', path: '/api/images/:kind/:name', body: Upload, response: z.object({ name: z.string(), source: z.literal('custom') }) }),
  remove: endpoint({ method: 'DELETE', path: '/api/images/:kind/:name', response: z.undefined(), status: 204 }),
};
