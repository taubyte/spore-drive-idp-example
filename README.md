# Your Own PaaS/IDP as Code - A Spore Drive Example

Creating a custom cloud platform brings powerful advantages—cost savings, full control, data sovereignty, and, crucially, the ability to make your solution self-hostable. This tool helps you deploy [Tau](https://github.com/taubyte/tau), an open-source PaaS/IDP, across your servers using [Spore-drive](https://www.npmjs.com/package/@taubyte/spore-drive).

## Getting Started

1. **Install Dependencies**  
   Run the following command to install the necessary packages:
   ```bash
   npm install
   ```

2. **Prepare Server List**  
   Create a CSV file (default: `hosts.csv`) with your server information:
   ```csv
   hostname,public_ip
   server1.example.com,192.168.1.1
   server2.example.com,192.168.1.2
   ```

3. **Configure Environment**  
   Copy the example environment file and edit it with your values:
   ```bash
   cp .env.example .env
   ```

   The following variables can be configured in your `.env` file:
   ```bash
   # Server Configuration
   SSH_KEY=ssh-key.pem                    # Path to SSH private key
   SERVERS_CSV_PATH=hosts.csv           # Path to servers list
   SSH_USER=ssh-user                 # SSH user for server access

   # Domain Configuration
   ROOT_DOMAIN=pom.ac                  # Root domain for your platform
   GENERATED_DOMAIN=g.pom.ac           # Generated subdomain for your platform

   # Namecheap DNS Configuration (Optional)
   NAMECHEAP_API_KEY=your_api_key
   NAMECHEAP_IP=your_ip
   NAMECHEAP_USERNAME=your_username
   ```

4. **Deploy**  
   Deploy your platform with:
   ```bash
   npm run displace
   ```

## CSV File Format

The servers CSV file should contain the following columns:
- `hostname`: The fully qualified domain name of your server
- `public_ip`: The public IP address of your server

Example:
```csv
hostname,public_ip
node1.mycloud.com,203.0.113.1
node2.mycloud.com,203.0.113.2
```

## Server Requirements

- Linux servers with SSH access on port 22
- User account (defaults to 'ssh-user') with:
  - sudo/root privileges
  - SSH key authentication enabled

