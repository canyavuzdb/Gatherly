export type VerificationEmail = {
  email: string;
  verificationSecret: string;
};

export type PasswordResetEmail = {
  email: string;
  resetSecret: string;
};

export interface AuthEmailDelivery {
  sendVerificationEmail(message: VerificationEmail): Promise<void>;
  sendPasswordResetEmail(message: PasswordResetEmail): Promise<void>;
}
