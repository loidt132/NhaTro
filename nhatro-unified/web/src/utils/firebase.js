import { initializeApp, getApps } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}

function getFirebaseApp() {
  if (!isFirebaseConfigured()) {
    throw new Error('Đăng nhập khách thuê chưa được cấu hình (thiếu VITE_FIREBASE_*).');
  }
  return getApps()[0] || initializeApp(firebaseConfig);
}

let recaptchaVerifier = null;

function getRecaptchaVerifier(containerId) {
  const auth = getAuth(getFirebaseApp());
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  }
  return recaptchaVerifier;
}

// Firebase expects E.164 (+84...) numbers; normalize a Vietnamese local number.
export function toE164(rawPhone = '') {
  const digits = String(rawPhone).replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('84')) return `+${digits}`;
  if (digits.startsWith('0')) return `+84${digits.slice(1)}`;
  return `+${digits}`;
}

export async function sendOtp(rawPhone, containerId) {
  const auth = getAuth(getFirebaseApp());
  const verifier = getRecaptchaVerifier(containerId);
  const phoneNumber = toE164(rawPhone);
  return signInWithPhoneNumber(auth, phoneNumber, verifier);
}

export async function confirmOtp(confirmationResult, code) {
  const credential = await confirmationResult.confirm(code);
  return credential.user.getIdToken();
}
