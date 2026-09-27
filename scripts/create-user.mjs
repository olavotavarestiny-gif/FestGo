import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const [email, name, role = "ADMIN"] = process.argv.slice(2);
const password = process.env.STAFF_PASSWORD;
if (
  !email ||
  !name ||
  !["ADMIN", "OPERATOR"].includes(role) ||
  !password ||
  password.length < 12
) {
  throw new Error(
    "Uso: STAFF_PASSWORD='...' node scripts/create-user.mjs email nome ADMIN|OPERATOR",
  );
}
const salt = randomBytes(16).toString("base64url");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("base64url")}`;
const prisma = new PrismaClient();
try {
  await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { name, role, passwordHash, active: true },
    create: { email: email.toLowerCase(), name, role, passwordHash },
  });
  console.log(`Utilizador ${role} configurado.`);
} finally {
  await prisma.$disconnect();
}
