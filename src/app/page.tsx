import { redirect } from "next/navigation";
import { currentUserId } from "@/server/session";
import { userRepository } from "@/server/users";

export default async function HomePage() {
  const userId = await currentUserId();
  const user = userId ? await userRepository().findById(userId) : null;
  redirect(user ? "/dashboard" : "/login");
}
