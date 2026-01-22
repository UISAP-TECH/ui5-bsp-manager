import axios, { AxiosInstance, AxiosRequestConfig } from "axios";

export interface SapProfile {
  name: string;
  server: string;
  client: string;
  user: string;
  useStrictSSL: boolean;
}

export interface SapConnectionConfig extends SapProfile {
  password: string;
}

export class SapConnection {
  private axiosInstance: AxiosInstance;
  private csrfToken: string | null = null;
  private config: SapConnectionConfig;

  constructor(config: SapConnectionConfig) {
    this.config = config;

    // Ensure server URL ends without slash
    const baseURL = config.server.endsWith("/")
      ? config.server.slice(0, -1)
      : config.server;

    this.axiosInstance = axios.create({
      baseURL,
      auth: {
        username: config.user,
        password: config.password,
      },
      headers: {
        Accept: "application/xml, application/json, text/plain, */*",
        "sap-client": config.client,
      },
      // Handle self-signed certificates
      httpsAgent: config.useStrictSSL
        ? undefined
        : new (require("https").Agent)({
            rejectUnauthorized: false,
          }),
    });

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          const status = error.response.status;
          if (status === 401) {
            throw new Error(
              "Authentication failed. Please check your credentials.",
            );
          } else if (status === 403) {
            throw new Error(
              "Access forbidden. Please check user authorizations.",
            );
          } else if (status === 404) {
            throw new Error(
              "Resource not found. Please check if ADT services are activated.",
            );
          }
        }
        throw error;
      },
    );
  }

  /**
   * Fetches CSRF token required for modifying operations
   */
  async fetchCsrfToken(): Promise<string> {
    if (this.csrfToken) {
      return this.csrfToken;
    }

    try {
      const response = await this.axiosInstance.get("/sap/bc/adt/discovery", {
        headers: {
          "X-CSRF-Token": "Fetch",
        },
      });

      this.csrfToken = response.headers["x-csrf-token"] || null;
      if (!this.csrfToken) {
        throw new Error("Failed to fetch CSRF token");
      }
      return this.csrfToken;
    } catch (error) {
      throw new Error(`Failed to fetch CSRF token: ${error}`);
    }
  }

  /**
   * Tests the connection to SAP server
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.axiosInstance.get("/sap/bc/adt/discovery");
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Makes a GET request to SAP
   */
  async get<T = any>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.axiosInstance.get<T>(path, config);
    return response.data;
  }

  /**
   * Makes a GET request and returns raw response (for binary data)
   */
  async getRaw(path: string, config?: AxiosRequestConfig): Promise<Buffer> {
    const response = await this.axiosInstance.get(path, {
      ...config,
      responseType: "arraybuffer",
    });
    return Buffer.from(response.data);
  }

  /**
   * Makes a POST request to SAP
   */
  async post<T = any>(
    path: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    await this.fetchCsrfToken();

    const response = await this.axiosInstance.post<T>(path, data, {
      ...config,
      headers: {
        ...config?.headers,
        "X-CSRF-Token": this.csrfToken,
      },
    });
    return response.data;
  }

  /**
   * Makes a PUT request to SAP
   */
  async put<T = any>(
    path: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    await this.fetchCsrfToken();

    const response = await this.axiosInstance.put<T>(path, data, {
      ...config,
      headers: {
        ...config?.headers,
        "X-CSRF-Token": this.csrfToken,
      },
    });
    return response.data;
  }

  getConfig(): SapProfile {
    return {
      name: this.config.name,
      server: this.config.server,
      client: this.config.client,
      user: this.config.user,
      useStrictSSL: this.config.useStrictSSL,
    };
  }
}
