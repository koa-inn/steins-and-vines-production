---
title: Hard enforcement upgrade for promo codes
trigger_condition: If promo code abuse becomes noticeable (repeat customers using FIRSTBATCH with alternate emails)
planted_date: 2026-05-03
---

## Idea

Add Zoho order history check to promo code validation. Before applying discount, query Zoho for prior sales orders matching the customer email. Only allow the promo if zero prior orders exist.

## Why Not Now

- Adds API call latency to checkout
- Customers can bypass by using a different email anyway
- In-store model provides natural social friction against abuse
- Current soft enforcement (one use per email via Redis) is sufficient for launch

## When to Revisit

- Revenue leakage from promo abuse exceeds acceptable threshold
- Moving to online-only sales where in-store friction doesn't apply
- Building a customer account system that ties identity more tightly
