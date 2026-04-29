import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { authPlugin } from "../auth/plugin";
import { createSession, invalidateSession, validateSession } from "../auth/session";
import {
  generateTOTPSecret,
  generateTOTPURI,
  generateQRCodeDataURL,
  verifyTOTP,
  generateRecoveryCodes,
} from "../auth/totp";
import { checkRateLimit, resetRateLimit } from "../auth/rate-limiter";
import { sendVerificationEmail } from "../email";

const ALLOWED_DOMAIN = "@knorr-bremse.com";
const CODE_EXPIRY_MS = 10 * 60 * 1000;

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

interface TempToken {
  userId: string;
  email: string;
  expiresAt: number;
  used: boolean;
}
const tempTokens = new Map<string, TempToken>();

setInterval(() => {
  const now = Date.now();
  for (const [key, token] of tempTokens.entries()) {
    if (now > token.expiresAt || token.used) {
      tempTokens.delete(key);
    }
  }
}, 2 * 60 * 1000);

async function sendCodeToUser(userId: string, email: string): Promise<void> {
  const code = generateVerificationCode();
  await db.user.update({
    where: { id: userId },
    data: {
      verificationCode: code,
      verificationExpiresAt: new Date(Date.now() + CODE_EXPIRY_MS),
    },
  });
  await sendVerificationEmail(email, code);
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .use(authPlugin)

  .post("/register", async ({ body, set, cookie: { auth_session } }) => {
    const { username, email, password } = body;

    if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
      set.status = 400;
      return { success: false, message: `Only ${ALLOWED_DOMAIN} emails are accepted` };
    }

    const limit = checkRateLimit(`register-${email}`, 3, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const hashedPassword = await Bun.password.hash(password);

    try {
      const user = await db.user.create({
        data: { username, email, password: hashedPassword, emailVerified: false },
      });

      await sendCodeToUser(user.id, user.email);

      return { success: true, requiresVerification: true, email: user.email };
    } catch (e) {
      set.status = 400;
      return { success: false, message: "Username or email already exists" };
    }
  }, {
    body: t.Object({
      username: t.String({ minLength: 3, maxLength: 64 }),
      email: t.String({ format: "email", maxLength: 255 }),
      password: t.String({ minLength: 8, maxLength: 128 }),
    }),
    cookie: t.Object({
      auth_session: t.Optional(t.String()),
    }),
  })

  .post("/login", async ({ body, set, cookie: { auth_session } }) => {
    const { email, password } = body;

    const limit = checkRateLimit(`login-${email}`, 10, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      set.status = 400;
      return { success: false, message: "Invalid credentials" };
    }

    const isMatch = await Bun.password.verify(password, user.password);
    if (!isMatch) {
      set.status = 400;
      return { success: false, message: "Invalid credentials" };
    }

    if (!user.emailVerified) {
      await sendCodeToUser(user.id, user.email);
      return { success: true, requiresVerification: true, email: user.email };
    }

    if (user.totpEnabled) {
      const tempToken = crypto.randomUUID();
      tempTokens.set(tempToken, {
        userId: user.id,
        email: user.email,
        expiresAt: Date.now() + 5 * 60 * 1000,
        used: false,
      });

      return {
        success: true,
        requires2FA: true,
        tempToken,
      };
    }

    const session = await createSession(user.id);

    auth_session.set({
      value: session.id,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return { success: true, user: { id: user.id, username: user.username } };
  }, {
    body: t.Object({
      email: t.String({ maxLength: 255 }),
      password: t.String({ minLength: 1, maxLength: 128 }),
    }),
    cookie: t.Object({
      auth_session: t.Optional(t.String()),
    }),
  })

  .post("/login/verify-2fa", async ({ body, set, cookie: { auth_session } }) => {
    const { tempToken, code } = body;

    const limit = checkRateLimit(`2fa-verify-${tempToken}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const token = tempTokens.get(tempToken);
    if (!token || token.used || Date.now() > token.expiresAt) {
      set.status = 400;
      return { success: false, message: "Invalid or expired token" };
    }

    const user = await db.user.findUnique({ where: { id: token.userId } });
    if (!user || !user.totpSecret) {
      set.status = 400;
      return { success: false, message: "2FA not configured" };
    }

    if (!verifyTOTP(user.totpSecret, code)) {
      return { success: false, message: "Invalid code" };
    }

    token.used = true;
    tempTokens.delete(tempToken);
    resetRateLimit(`2fa-verify-${tempToken}`);

    const session = await createSession(user.id);

    auth_session.set({
      value: session.id,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return { success: true, user: { id: user.id, username: user.username } };
  }, {
    body: t.Object({
      tempToken: t.String(),
      code: t.String(),
    }),
    cookie: t.Object({
      auth_session: t.Optional(t.String()),
    }),
  })

  .post("/send-verification", async ({ body, set }) => {
    const { email } = body;

    const limit = checkRateLimit(`send-verify-${email}`, 3, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      set.status = 400;
      return { success: false, message: "No account found with this email" };
    }

    if (user.emailVerified) {
      return { success: false, message: "Email is already verified" };
    }

    await sendCodeToUser(user.id, user.email);
    resetRateLimit(`send-verify-${email}`);

    return { success: true };
  }, {
    body: t.Object({
      email: t.String({ format: "email", maxLength: 255 }),
    }),
  })

  .post("/verify-email", async ({ body, set, cookie: { auth_session } }) => {
    const { email, code } = body;

    const limit = checkRateLimit(`verify-email-${email}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      set.status = 400;
      return { success: false, message: "No account found" };
    }

    if (user.emailVerified) {
      return { success: false, message: "Email is already verified" };
    }

    if (!user.verificationCode || !user.verificationExpiresAt) {
      set.status = 400;
      return { success: false, message: "No verification code found. Request a new one." };
    }

    if (Date.now() > user.verificationExpiresAt.getTime()) {
      set.status = 400;
      return { success: false, message: "Verification code has expired. Request a new one." };
    }

    if (user.verificationCode !== code) {
      return { success: false, message: "Invalid code" };
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationCode: null,
        verificationExpiresAt: null,
      },
    });

    resetRateLimit(`verify-email-${email}`);

    const session = await createSession(user.id);

    auth_session.set({
      value: session.id,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return { success: true, user: { id: user.id, username: user.username } };
  }, {
    body: t.Object({
      email: t.String({ format: "email", maxLength: 255 }),
      code: t.String({ minLength: 6, maxLength: 6 }),
    }),
    cookie: t.Object({
      auth_session: t.Optional(t.String()),
    }),
  })

  .get("/me", async ({ cookie: { auth_session } }) => {
    const sessionId = auth_session?.value;
    if (typeof sessionId !== "string") {
      return { success: false, user: null };
    }
    const { user } = await validateSession(sessionId);
    if (!user) return { success: false, user: null };
    return { success: true, user: { id: user.id, username: user.username, emailVerified: user.emailVerified } };
  })

  .post("/logout", async ({ cookie: { auth_session } }) => {
    if (auth_session.value) {
      await invalidateSession(auth_session.value);
      auth_session.remove();
    }
    return { success: true };
  }, {
    cookie: t.Object({
      auth_session: t.Optional(t.String()),
    }),
  })

  .get("/account", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        username: true,
        email: true,
        emailVerified: true,
        totpEnabled: true,
        createdAt: true,
      },
    });
    return { success: true, user: dbUser };
  })

  .patch("/account", async ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }
    const { username, email } = body;
    try {
      const updated = await db.user.update({
        where: { id: user.id },
        data: {
          ...(username ? { username } : {}),
          ...(email ? { email } : {}),
        },
        select: { id: true, username: true, email: true },
      });
      return { success: true, user: updated };
    } catch (e: any) {
      set.status = 400;
      return { success: false, message: e?.code === "P2002" ? "Username or email already exists" : "Update failed" };
    }
  }, {
    body: t.Object({
      username: t.Optional(t.String()),
      email: t.Optional(t.String()),
    }),
  })

  .post("/account/change-password", async ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }
    const { currentPassword, newPassword } = body;

    const dbUser = await db.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      set.status = 400;
      return { success: false, message: "User not found" };
    }

    const isMatch = await Bun.password.verify(currentPassword, dbUser.password);
    if (!isMatch) {
      set.status = 400;
      return { success: false, message: "Current password is incorrect" };
    }

    const hashedNew = await Bun.password.hash(newPassword);
    await db.user.update({
      where: { id: user.id },
      data: { password: hashedNew },
    });

    await db.session.deleteMany({ where: { userId: user.id } });

    return { success: true, message: "Password changed. All sessions invalidated." };
  }, {
    body: t.Object({
      currentPassword: t.String(),
      newPassword: t.String(),
    }),
  })

  .post("/totp/setup", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }
    if (user.totpEnabled) {
      set.status = 400;
      return { success: false, message: "2FA already enabled" };
    }

    const secret = generateTOTPSecret();

    await db.user.update({
      where: { id: user.id },
      data: { totpSecret: secret },
    });

    const uri = generateTOTPURI(secret, user.username);
    const qrCode = await generateQRCodeDataURL(uri);

    return { success: true, secret, qrCode };
  })

  .post("/totp/enable", async ({ user, body, set, cookie: { auth_session } }) => {
    if (!user) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }

    const dbUser = await db.user.findUnique({ where: { id: user.id } });
    if (!dbUser || !dbUser.totpSecret) {
      set.status = 400;
      return { success: false, message: "Run setup first" };
    }

    if (!verifyTOTP(dbUser.totpSecret, body.code)) {
      set.status = 400;
      return { success: false, message: "Invalid code" };
    }

    const recoveryCodes = generateRecoveryCodes(10);
    const hashedCodes = await Promise.all(
      recoveryCodes.map((code) => Bun.password.hash(code))
    );

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { totpEnabled: true },
      }),
      db.recoveryCode.deleteMany({ where: { userId: user.id } }),
      db.recoveryCode.createMany({
        data: hashedCodes.map((hash) => ({ userId: user.id, hash })),
      }),
    ]);

    return { success: true, recoveryCodes };
  }, {
    body: t.Object({
      code: t.String(),
    }),
  })

  .post("/totp/disable", async ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }

    const dbUser = await db.user.findUnique({ where: { id: user.id } });
    if (!dbUser || !dbUser.totpEnabled) {
      set.status = 400;
      return { success: false, message: "2FA is not enabled" };
    }

    const isMatch = await Bun.password.verify(body.password, dbUser.password);
    if (!isMatch) {
      set.status = 400;
      return { success: false, message: "Incorrect password" };
    }

    if (dbUser.totpSecret && !verifyTOTP(dbUser.totpSecret, body.code)) {
      set.status = 400;
      return { success: false, message: "Invalid TOTP code" };
    }

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { totpEnabled: false, totpSecret: null },
      }),
      db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);

    return { success: true, message: "2FA disabled" };
  }, {
    body: t.Object({
      password: t.String(),
      code: t.String(),
    }),
  })

  .post("/totp/regenerate-codes", async ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }

    const dbUser = await db.user.findUnique({ where: { id: user.id } });
    if (!dbUser || !dbUser.totpEnabled || !dbUser.totpSecret) {
      set.status = 400;
      return { success: false, message: "2FA not enabled" };
    }

    if (!verifyTOTP(dbUser.totpSecret, body.code)) {
      set.status = 400;
      return { success: false, message: "Invalid TOTP code" };
    }

    const recoveryCodes = generateRecoveryCodes(10);
    const hashedCodes = await Promise.all(
      recoveryCodes.map((code) => Bun.password.hash(code))
    );

    await db.$transaction([
      db.recoveryCode.deleteMany({ where: { userId: user.id } }),
      db.recoveryCode.createMany({
        data: hashedCodes.map((hash) => ({ userId: user.id, hash })),
      }),
    ]);

    return { success: true, recoveryCodes };
  }, {
    body: t.Object({
      code: t.String(),
    }),
  })

  .post("/totp/status", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { totpEnabled: true },
    });
    return { success: true, totpEnabled: dbUser?.totpEnabled ?? false };
  })

  .post("/forgot-password", async ({ body, set }) => {
    const { email } = body;

    const limit = checkRateLimit(`forgot-pw-${email}`, 3, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, totpEnabled: true, emailVerified: true },
    });

    if (!user) {
      return { success: false, message: "No account found with this email" };
    }

    if (user.totpEnabled) {
      return {
        success: true,
        requiresTOTP: true,
      };
    }

    await sendCodeToUser(user.id, email);

    return {
      success: true,
      requiresEmailCode: true,
      email,
    };
  }, {
    body: t.Object({
      email: t.String(),
    }),
  })

  .post("/recovery/verify-email-code", async ({ body, set }) => {
    const { email, code } = body;

    const limit = checkRateLimit(`recovery-email-code-${email}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      set.status = 400;
      return { success: false, message: "No account found" };
    }

    if (!user.verificationCode || !user.verificationExpiresAt) {
      set.status = 400;
      return { success: false, message: "No verification code found. Request a new one." };
    }

    if (Date.now() > user.verificationExpiresAt.getTime()) {
      set.status = 400;
      return { success: false, message: "Verification code has expired. Request a new one." };
    }

    if (user.verificationCode !== code) {
      return { success: false, message: "Invalid code" };
    }

    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.passwordResetToken.create({
      data: {
        token: resetToken,
        userId: user.id,
        expiresAt,
      },
    });

    resetRateLimit(`recovery-email-code-${email}`);

    return { success: true, resetToken };
  }, {
    body: t.Object({
      email: t.String(),
      code: t.String(),
    }),
  })

  .post("/recovery/verify-totp", async ({ body, set }) => {
    const { email, code } = body;

    const limit = checkRateLimit(`recovery-totp-${email}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !user.totpSecret || !user.totpEnabled) {
      set.status = 400;
      return { success: false, message: "2FA not enabled for this account" };
    }

    if (!verifyTOTP(user.totpSecret, code)) {
      return { success: false, message: "Invalid code" };
    }

    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.passwordResetToken.create({
      data: {
        token: resetToken,
        userId: user.id,
        expiresAt,
      },
    });

    resetRateLimit(`recovery-totp-${email}`);

    return { success: true, resetToken };
  }, {
    body: t.Object({
      email: t.String(),
      code: t.String(),
    }),
  })

  .post("/recovery/verify-code", async ({ body, set }) => {
    const { email, recoveryCode } = body;

    const limit = checkRateLimit(`recovery-code-${email}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { success: false, message: "Too many attempts. Try again later." };
    }

    const user = await db.user.findUnique({
      where: { email },
      include: { recoveryCodes: { where: { used: false } } },
    });
    if (!user || user.recoveryCodes.length === 0) {
      set.status = 400;
      return { success: false, message: "No valid recovery codes found" };
    }

    let matchedCodeId: string | null = null;
    for (const rc of user.recoveryCodes) {
      const isValid = await Bun.password.verify(recoveryCode, rc.hash);
      if (isValid) {
        matchedCodeId = rc.id;
        break;
      }
    }

    if (!matchedCodeId) {
      return { success: false, message: "Invalid recovery code" };
    }

    await db.recoveryCode.update({
      where: { id: matchedCodeId },
      data: { used: true },
    });

    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.passwordResetToken.create({
      data: {
        token: resetToken,
        userId: user.id,
        expiresAt,
      },
    });

    resetRateLimit(`recovery-code-${email}`);

    return { success: true, resetToken };
  }, {
    body: t.Object({
      email: t.String(),
      recoveryCode: t.String(),
    }),
  })

  .post("/reset-password", async ({ body, set, cookie: { auth_session } }) => {
    const { resetToken, newPassword } = body;

    const token = await db.passwordResetToken.findUnique({
      where: { token: resetToken },
    });

    if (!token || token.used || Date.now() > token.expiresAt.getTime()) {
      set.status = 400;
      return { success: false, message: "Invalid or expired token" };
    }

    const hashedPassword = await Bun.password.hash(newPassword);

    await db.$transaction([
      db.user.update({
        where: { id: token.userId },
        data: { password: hashedPassword },
      }),
      db.passwordResetToken.update({
        where: { id: token.id },
        data: { used: true },
      }),
      db.session.deleteMany({ where: { userId: token.userId } }),
    ]);

    if (auth_session.value) {
      auth_session.remove();
    }

    return { success: true, message: "Password reset successfully. Please log in." };
  }, {
    body: t.Object({
      resetToken: t.String(),
      newPassword: t.String(),
    }),
    cookie: t.Object({
      auth_session: t.Optional(t.String()),
    }),
  });
