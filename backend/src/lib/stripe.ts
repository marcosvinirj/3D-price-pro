/** Cliente Stripe unico (chave secreta — nunca exposta ao frontend). */
import Stripe from 'stripe';
import { env } from '../config/env.js';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY);
