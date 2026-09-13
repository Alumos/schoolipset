namespace SchoolIpSet.Client
{
    internal static class ServerSettings
    {
        // The release workflow replaces the public key placeholder from a GitHub secret.
        // Keep the API URL configurable in source so a release can target the school VPS.
        public const string ApiBaseUrl = "http://139.196.136.61:18080/";
        public const string ServerPublicKeyJwk = "__SERVER_PUBLIC_KEY_JWK__";
        public const string ClientVersion = "0.1.0";
    }
}
