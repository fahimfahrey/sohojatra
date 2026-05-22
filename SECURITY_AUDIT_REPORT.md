# 🔒 Security Audit Report - Sohojatra Ride Share Application

**Date:** May 15, 2026  
**Severity Levels:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## Executive Summary

This comprehensive security audit identified **12 critical/high-severity vulnerabilities** and **8 medium-severity issues** in the Sohojatra ride-share application. The most critical issues involve exposed API keys, sensitive data exposure, and insufficient access controls. Immediate remediation is required before production deployment.

---

## 🔴 CRITICAL VULNERABILITIES

### 1. **Exposed API Keys in Version Control**

**Severity:** 🔴 CRITICAL  
**Location:** `.env.local` (committed to repository)  
**Issue:**

- Supabase anonymous key is exposed: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- Ably API key is exposed: `jmPaXA.TIfumw:U3-E3yMaUqokGhkVB0OPkhsqCldOzOYkTkNsLL9VRbw`
- `.env.local` is NOT in `.gitignore` (only `.env` is listed)
- These keys can be used to access your Supabase project and Ably service

**Impact:**

- Attackers can access your entire database
- Unauthorized real-time messaging through Ably
- Potential data theft, modification, or deletion
- Service abuse and unexpected billing

**Remediation:**

```bash
# 1. Immediately revoke exposed keys in Supabase and Ably dashboards
# 2. Generate new API keys
# 3. Update .gitignore
# 4. Remove .env.local from git history
```

**Fix:**

```diff
# .gitignore
.env
+ .env.local
+ .env.*.local
```

---

### 2. **Sensitive Data Exposure - Phone Numbers**

**Severity:** 🔴 CRITICAL  
**Location:** `src/lib/database.ts`, `src/components/rides/PhoneNumberModal.tsx`  
**Issue:**

- Phone numbers stored in plaintext in `ride_passengers` table
- Accessible to all authenticated users via `fetchRidePassengersWithDetails()`
- No encryption or masking applied
- Shared with ride participants without explicit consent

**Impact:**

- PII (Personally Identifiable Information) exposure
- Privacy violation - phone numbers linked to ride history
- Potential harassment or spam targeting
- GDPR/privacy law violations

**Affected Code:**

```typescript
// src/lib/database.ts - Line 108
export const fetchRidePassengersWithDetails = async (rideId: string) => {
  const { data, error } = await supabase
    .from("ride_passengers")
    .select("user_id, contact_phone") // ⚠️ Plaintext phone numbers
    .eq("ride_id", rideId);
  return data || [];
};
```

**Remediation:**

- Encrypt phone numbers at rest using Supabase's encryption
- Implement field-level encryption
- Only reveal phone numbers to ride creator and joined passengers
- Add RLS policies to restrict access

---

### 3. **Overly Permissive Row-Level Security (RLS) Policies**

**Severity:** 🔴 CRITICAL  
**Location:** `supabase/migrations/20250509000001_improved_rls.sql`  
**Issue:**

```sql
-- VULNERABLE: Users can read ANY user data
CREATE POLICY "Users can read any user data"
  ON users
  FOR SELECT
  TO authenticated
  USING (true);  -- ⚠️ No restrictions!

-- VULNERABLE: Anyone can create notifications for anyone
CREATE POLICY "Users can create notifications for anyone"
  ON notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);  -- ⚠️ No user_id check!
```

**Impact:**

- Any authenticated user can read all other users' data (name, email)
- Any user can create notifications for any other user (spam/harassment)
- No data isolation between users
- Violates principle of least privilege

**Remediation:**

```sql
-- FIXED: Users can only read their own data
CREATE POLICY "Users can read their own data"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- FIXED: Only system can create notifications
CREATE POLICY "System can create notifications"
  ON notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

---

### 4. **Insufficient Input Validation - Phone Numbers**

**Severity:** 🔴 CRITICAL  
**Location:** `src/components/rides/PhoneNumberModal.tsx`  
**Issue:**

- Only client-side regex validation: `/^\+?[0-9]{10,15}$/`
- No server-side validation on database operations
- No sanitization of phone number input
- Regex can be bypassed

**Impact:**

- Invalid data stored in database
- Potential injection attacks
- Data integrity issues
- No protection against malicious input

**Affected Code:**

```typescript
// src/components/rides/PhoneNumberModal.tsx - Line 20
const phoneRegex = /^\+?[0-9]{10,15}$/;
if (!phoneRegex.test(phoneNumber.replace(/\s|-/g, ""))) {
  setError("Please enter a valid phone number");
  return;
}
// ⚠️ No server-side validation!
```

**Remediation:**

- Add server-side validation in Supabase functions
- Implement phone number format validation
- Add input sanitization
- Use Supabase RLS with CHECK constraints

---

### 5. **Sensitive Data in Browser localStorage**

**Severity:** 🔴 CRITICAL  
**Location:** `src/lib/sessionHelper.ts`, `src/contexts/AuthContext.tsx`  
**Issue:**

- Full authentication tokens stored in localStorage
- Tokens include user metadata and sensitive information
- Vulnerable to XSS (Cross-Site Scripting) attacks
- No HttpOnly flag (browser-only storage)

**Impact:**

- XSS attack can steal entire session
- Attacker gains full user access
- No protection against malicious scripts
- Session hijacking possible

**Affected Code:**

```typescript
// src/lib/sessionHelper.ts - Line 15
const tokenStr = localStorage.getItem(tokenKey);
const token = JSON.parse(tokenStr);
// ⚠️ Full token stored in localStorage, vulnerable to XSS
```

**Remediation:**

- Use HttpOnly cookies instead of localStorage
- Implement CSRF protection
- Add Content Security Policy (CSP) headers
- Use Supabase's built-in session management

---

## 🟠 HIGH SEVERITY VULNERABILITIES

### 6. **Unvalidated OAuth Redirect URL**

**Severity:** 🟠 HIGH  
**Location:** `src/lib/auth.ts` (Line 95)  
**Issue:**

```typescript
const redirectUrl = import.meta.env.VITE_AUTH_REDIRECT_URL;
// ⚠️ No validation that this is a safe URL
```

**Impact:**

- Open redirect vulnerability
- Attacker can redirect users to malicious sites
- Phishing attacks possible
- OAuth token interception

**Remediation:**

```typescript
const ALLOWED_REDIRECT_URLS = [
  "https://sohojatra.vercel.app/auth/callback",
  "https://sohojatra.com/auth/callback",
];

const redirectUrl = import.meta.env.VITE_AUTH_REDIRECT_URL;
if (!ALLOWED_REDIRECT_URLS.includes(redirectUrl)) {
  throw new Error("Invalid redirect URL");
}
```

---

### 7. **Information Disclosure via Error Messages**

**Severity:** 🟠 HIGH  
**Location:** Multiple files - `src/lib/auth.ts`, `src/contexts/RideContext.tsx`  
**Issue:**

- Auth errors reveal whether email exists: "User already registered"
- Database errors logged to console with full details
- Stack traces exposed in error messages

**Impact:**

- User enumeration attacks
- Information leakage about system structure
- Helps attackers craft targeted attacks

**Affected Code:**

```typescript
// src/lib/auth.ts - Line 48
if (existingUser) {
  throw new Error("User already registered"); // ⚠️ Reveals user existence
}
```

**Remediation:**

```typescript
// Generic error messages
throw new Error("Registration failed. Please try again.");
// Log detailed errors server-side only
console.error("Detailed error:", error); // Only in development
```

---

### 8. **Unencrypted Real-Time Data Transmission**

**Severity:** 🟠 HIGH  
**Location:** `src/contexts/RideContext.tsx`, `src/contexts/AblyContext.tsx`  
**Issue:**

- Ride details (location, passenger info) sent over Ably without encryption
- Real-time events contain sensitive data
- No end-to-end encryption

**Impact:**

- Eavesdropping on ride information
- Location tracking possible
- Passenger information exposure

**Affected Code:**

```typescript
// src/contexts/RideContext.tsx - Line 280
publishEvent("rides", "new", newRide); // ⚠️ Unencrypted ride data
```

---

### 9. **Missing Rate Limiting on Authentication**

**Severity:** 🟠 HIGH  
**Location:** `src/lib/auth.ts`  
**Issue:**

- No rate limiting on login/signup endpoints
- No brute force protection
- No account lockout mechanism

**Impact:**

- Brute force password attacks
- Credential stuffing attacks
- Account takeover possible

**Remediation:**

- Implement rate limiting in Supabase
- Add exponential backoff
- Implement CAPTCHA after failed attempts

---

### 10. **Ride Status Update Race Conditions**

**Severity:** 🟠 HIGH  
**Location:** `src/lib/database.ts` (Line 200-250)  
**Issue:**

```typescript
// Race condition: Check then update
const { data: ride } = await supabase
  .from("ride_requests")
  .select("seats_available")
  .eq("id", rideId)
  .single();

// ⚠️ Another user could modify ride between check and update
const newSeatsAvailable = ride.seats_available - 1;
```

**Impact:**

- Overbooking of rides
- Seat count inconsistencies
- Data integrity issues

**Remediation:**

- Use database transactions
- Implement optimistic locking
- Use atomic operations

---

### 11. **Insufficient Authorization Checks**

**Severity:** 🟠 HIGH  
**Location:** `src/contexts/RideContext.tsx`  
**Issue:**

- Client-side authorization checks only
- No server-side verification of user permissions
- Ride creator verification happens in frontend

**Impact:**

- Authorization bypass possible
- Unauthorized ride modifications
- Privilege escalation

**Remediation:**

- Move all authorization to Supabase RLS
- Verify permissions server-side
- Never trust client-side checks

---

### 12. **Exposed Sensitive Information in Console Logs**

**Severity:** 🟠 HIGH  
**Location:** Throughout codebase  
**Issue:**

- Extensive console.log statements with sensitive data
- User IDs, ride details, phone numbers logged
- Visible in browser DevTools

**Impact:**

- Information disclosure
- Debugging information exposed
- Sensitive data in browser history

**Affected Code:**

```typescript
// src/lib/database.ts - Line 15
console.error("Error fetching rides:", error); // ⚠️ Full error details

// src/contexts/RideContext.tsx - Line 50
console.log("Fetched ${data.length} rides from database"); // ⚠️ Ride count
```

---

## 🟡 MEDIUM SEVERITY ISSUES

### 13. **Missing Content Security Policy (CSP)**

**Severity:** 🟡 MEDIUM  
**Location:** `index.html`  
**Issue:**

- No CSP headers configured
- Vulnerable to XSS attacks
- No protection against inline scripts

**Remediation:**

```html
<!-- index.html -->
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
/>
```

---

### 14. **No HTTPS Enforcement**

**Severity:** 🟡 MEDIUM  
**Location:** Application configuration  
**Issue:**

- No explicit HTTPS requirement in code
- Relies on deployment configuration
- Potential for man-in-the-middle attacks

**Remediation:**

```typescript
// src/main.tsx
if (
  window.location.protocol !== "https:" &&
  process.env.NODE_ENV === "production"
) {
  window.location.protocol = "https:";
}
```

---

### 15. **Missing CORS Configuration**

**Severity:** 🟡 MEDIUM  
**Location:** Supabase configuration  
**Issue:**

- No explicit CORS policy configured
- Potential for cross-origin attacks

**Remediation:**

- Configure CORS in Supabase dashboard
- Whitelist only trusted origins

---

### 16. **No Session Timeout**

**Severity:** 🟡 MEDIUM  
**Location:** `src/contexts/AuthContext.tsx`  
**Issue:**

- Sessions don't expire automatically
- No idle timeout mechanism
- Long-lived tokens increase risk

**Remediation:**

```typescript
// Implement session timeout
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
```

---

### 17. **Insufficient Password Requirements**

**Severity:** 🟡 MEDIUM  
**Location:** `src/components/auth/RegisterForm.tsx`  
**Issue:**

- No password strength validation
- No minimum length enforcement
- No complexity requirements

**Remediation:**

- Enforce minimum 12 characters
- Require uppercase, lowercase, numbers, symbols
- Check against common passwords

---

### 18. **Missing Audit Logging**

**Severity:** 🟡 MEDIUM  
**Location:** Database operations  
**Issue:**

- No audit trail for sensitive operations
- No tracking of who modified what
- Compliance issues

**Remediation:**

- Implement audit logging table
- Log all user actions
- Track data modifications

---

### 19. **No Two-Factor Authentication (2FA)**

**Severity:** 🟡 MEDIUM  
**Location:** Authentication system  
**Issue:**

- Only password-based authentication
- No 2FA option available
- Account takeover risk

**Remediation:**

- Implement TOTP-based 2FA
- Add SMS-based 2FA option
- Make 2FA optional for users

---

### 20. **Insufficient Data Retention Policy**

**Severity:** 🟡 MEDIUM  
**Location:** Database schema  
**Issue:**

- No data deletion policy
- No GDPR "right to be forgotten" implementation
- Indefinite data retention

**Remediation:**

- Implement data retention policies
- Add user data deletion functionality
- Comply with GDPR requirements

---

## 🟢 LOW SEVERITY ISSUES

### 21. **Missing Security Headers**

**Severity:** 🟢 LOW  
**Location:** Server configuration  
**Issue:**

- No X-Frame-Options header
- No X-Content-Type-Options header
- No Strict-Transport-Security header

**Remediation:**

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

### 22. **No Dependency Vulnerability Scanning**

**Severity:** 🟢 LOW  
**Location:** `package.json`  
**Issue:**

- No automated dependency scanning
- Potential vulnerable packages

**Remediation:**

```bash
npm audit
npm audit fix
```

---

## Summary Table

| #     | Vulnerability                  | Severity    | Category               | Status    |
| ----- | ------------------------------ | ----------- | ---------------------- | --------- |
| 1     | Exposed API Keys               | 🔴 CRITICAL | Secrets                | Not Fixed |
| 2     | Phone Numbers Plaintext        | 🔴 CRITICAL | Data Exposure          | Not Fixed |
| 3     | Overly Permissive RLS          | 🔴 CRITICAL | Authorization          | Not Fixed |
| 4     | Insufficient Input Validation  | 🔴 CRITICAL | Input Validation       | Not Fixed |
| 5     | Sensitive Data in localStorage | 🔴 CRITICAL | Session Management     | Not Fixed |
| 6     | Unvalidated OAuth Redirect     | 🟠 HIGH     | Authentication         | Not Fixed |
| 7     | Information Disclosure         | 🟠 HIGH     | Error Handling         | Not Fixed |
| 8     | Unencrypted Real-Time Data     | 🟠 HIGH     | Data Transmission      | Not Fixed |
| 9     | Missing Rate Limiting          | 🟠 HIGH     | Authentication         | Not Fixed |
| 10    | Race Conditions                | 🟠 HIGH     | Data Integrity         | Not Fixed |
| 11    | Insufficient Authorization     | 🟠 HIGH     | Authorization          | Not Fixed |
| 12    | Console Logs Exposure          | 🟠 HIGH     | Information Disclosure | Not Fixed |
| 13-20 | Medium Issues                  | 🟡 MEDIUM   | Various                | Not Fixed |
| 21-22 | Low Issues                     | 🟢 LOW      | Various                | Not Fixed |

---

## Immediate Action Items (Priority Order)

### Phase 1: Critical (Do Immediately)

1. ✅ Revoke exposed API keys in Supabase and Ably
2. ✅ Generate new API keys
3. ✅ Update `.gitignore` to exclude `.env.local`
4. ✅ Remove `.env.local` from git history
5. ✅ Fix RLS policies to restrict data access
6. ✅ Implement phone number encryption
7. ✅ Move authentication to HttpOnly cookies

### Phase 2: High Priority (Within 1 week)

8. ✅ Add server-side input validation
9. ✅ Implement rate limiting
10. ✅ Add OAuth redirect validation
11. ✅ Remove sensitive console logs
12. ✅ Implement authorization checks server-side

### Phase 3: Medium Priority (Within 2 weeks)

13. ✅ Add CSP headers
14. ✅ Implement session timeout
15. ✅ Add password strength requirements
16. ✅ Implement audit logging
17. ✅ Add 2FA support

### Phase 4: Low Priority (Within 1 month)

18. ✅ Add security headers
19. ✅ Implement data retention policies
20. ✅ Set up dependency scanning

---

## Compliance Considerations

- **GDPR:** Phone number storage, data retention, right to deletion
- **CCPA:** User data access, deletion rights
- **PCI DSS:** If handling payment data (not currently)
- **SOC 2:** Audit logging, access controls

---

## Recommendations

1. **Implement a Security Review Process**
   - Code review checklist for security
   - Regular security audits
   - Penetration testing

2. **Use Security Tools**
   - OWASP ZAP for vulnerability scanning
   - npm audit for dependency vulnerabilities
   - SonarQube for code quality

3. **Security Training**
   - OWASP Top 10 training
   - Secure coding practices
   - Regular security updates

4. **Monitoring & Logging**
   - Implement centralized logging
   - Set up security alerts
   - Monitor for suspicious activity

---

## Conclusion

The Sohojatra application has **critical security vulnerabilities** that must be addressed before production deployment. The most urgent issues are:

1. Exposed API keys (immediate revocation required)
2. Overly permissive RLS policies
3. Plaintext phone number storage
4. Sensitive data in localStorage

Implementing the recommended fixes will significantly improve the security posture of the application. A follow-up security audit is recommended after implementing these fixes.

---

**Report Generated:** May 15, 2026  
**Auditor:** Kiro Security Analysis  
**Status:** ⚠️ NOT PRODUCTION READY
