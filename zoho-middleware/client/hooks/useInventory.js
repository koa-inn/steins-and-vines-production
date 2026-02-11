import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

/**
 * Validate and normalize a single product from the API.
 * Ensures numeric fields are actual numbers, not strings.
 */
function normalizeProduct(raw) {
  return {
    ...raw,
    rate: toNumber(raw.rate),
    purchase_rate: toNumber(raw.purchase_rate),
    stock_on_hand: toNumber(raw.stock_on_hand),
    available_stock: toNumber(raw.available_stock),
    actual_available_stock: toNumber(raw.actual_available_stock),
    reorder_level: toNumber(raw.reorder_level),
    initial_stock: toNumber(raw.initial_stock),
    initial_stock_rate: toNumber(raw.initial_stock_rate),

    // Zoho Books uses "rate" as the sell price — surface it as "price" too
    price: toNumber(raw.rate),
  };
}

/**
 * Coerce a value to a number. Returns 0 for anything unparseable.
 */
function toNumber(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    var parsed = parseFloat(val.replace(/[^0-9.\-]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Custom hook that fetches the product catalog from the Zoho middleware.
 *
 * Usage:
 *   const { products, isLoading, error, refetch } = useInventory();
 *
 * Returns:
 *   products  — normalized array of inventory items (empty array while loading)
 *   isLoading — true during the initial fetch or a refetch
 *   error     — Error object if the request failed, otherwise null
 *   refetch   — call this to force a fresh fetch (bypasses middleware cache)
 */
export default function useInventory() {
  var [products, setProducts] = useState([]);
  var [isLoading, setIsLoading] = useState(true);
  var [error, setError] = useState(null);

  var fetchProducts = useCallback(function () {
    setIsLoading(true);
    setError(null);

    return fetch(API_BASE + '/api/products', {
      credentials: 'include',
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (body) {
            throw new Error(body.error || 'HTTP ' + res.status);
          });
        }
        return res.json();
      })
      .then(function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        setProducts(items.map(normalizeProduct));
      })
      .catch(function (err) {
        console.error('[useInventory]', err.message);
        setError(err);
      })
      .finally(function () {
        setIsLoading(false);
      });
  }, []);

  useEffect(function () {
    fetchProducts();
  }, [fetchProducts]);

  return {
    products: products,
    isLoading: isLoading,
    error: error,
    refetch: fetchProducts,
  };
}
