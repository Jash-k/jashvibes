'use client';
import { useEffect, useState } from 'react';

/**
 * Owner-only quick-hide controls need the admin session cookie. The probe
 * never throws: visitors simply get isAdmin=false and no hide buttons.
 */
export default function useAdminSession() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/live/admin/session', { cache: 'no-store' })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => { if (alive) setIsAdmin(Boolean(data.admin)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return isAdmin;
}
