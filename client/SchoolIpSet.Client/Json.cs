using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace SchoolIpSet.Client
{
    internal static class Json
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };

        public static string Serialize(object value) => Serializer.Serialize(value);

        public static T Deserialize<T>(string value) => Serializer.Deserialize<T>(value);

        public static Dictionary<string, object> DeserializeObject(string value) =>
            Serializer.DeserializeObject(value) as Dictionary<string, object>;
    }
}
