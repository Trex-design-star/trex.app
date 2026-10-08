# Trex API — functional interim backend (Ruby stdlib only, zero installs).
# Implements the contracts in Docs/phase2-backend.md, phase3-5-backend.md,
# phase6-8-backend.md: server-side trade state machine, append-only ledger,
# idempotent financial operations, capacity enforcement, disputes, audit.
# Run: ruby api.rb  (serves the app + JSON API on port 8080)
# Port to NestJS + Postgres later without changing the frontend: same routes.
require 'webrick'
require 'json'
require 'fileutils'
require 'securerandom'
require 'net/http'
require 'uri'

ROOT = File.expand_path(__dir__)
DATA = File.join(ROOT, 'data')
FileUtils.mkdir_p(DATA)
PORT = (ARGV[0] || 8080).to_i

def read_json(name, default)
  f = File.join(DATA, name)
  return JSON.parse(JSON.generate(default)) unless File.exist?(f)
  JSON.parse(File.read(f))
rescue StandardError
  default
end

def write_json(name, obj)
  tmp = File.join(DATA, name + '.tmp')
  File.write(tmp, JSON.pretty_generate(obj))
  File.rename(tmp, File.join(DATA, name))
end

SEED_OFFERS = [
  { 'id' => 'OFR-1', 'provide' => 'USD', 'want' => 'NGN', 'rate' => 1520,
    'min' => 65, 'max' => 330, 'vendor' => 'Adaobi', 'country' => 'NG',
    'tier' => 'Gold', 'capacity' => 4000, 'rating' => 4.8, 'trades' => 312,
    'methods' => ['Bank transfer'], 'terms' => 'Pay within 30 minutes.', 'live' => true },
  { 'id' => 'OFR-2', 'provide' => 'GBP', 'want' => 'NGN', 'rate' => 1940,
    'min' => 103, 'max' => 2060, 'vendor' => 'Tunde', 'country' => 'NG',
    'tier' => 'Gold', 'capacity' => 3000, 'rating' => 4.9, 'trades' => 540,
    'methods' => ['Bank transfer'], 'terms' => 'Pay within 30 minutes.', 'live' => true },
  { 'id' => 'OFR-3', 'provide' => 'EUR', 'want' => 'NGN', 'rate' => 1650,
    'min' => 60, 'max' => 1500, 'vendor' => 'New vendor', 'country' => 'NG',
    'tier' => 'Probation', 'capacity' => 2000, 'rating' => nil, 'trades' => 3,
    'methods' => ['Bank transfer'], 'terms' => 'Pay within 1 hour.', 'live' => true }
].freeze

# First boot seeding (never overwrites existing data)
write_json('offers.json', SEED_OFFERS) unless File.exist?(File.join(DATA, 'offers.json'))
write_json('bond.json', { 'model' => 'standing', 'base' => 'USD',
  'caps' => { 'USD' => 10_000, 'NGN' => 8_000_000, 'GBP' => 4_000, 'EUR' => 6_000 },
  'reserved' => {}, 'fees_paid' => {} }) unless File.exist?(File.join(DATA, 'bond.json'))
write_json('config.json', { 'fee_pct' => 1.5, 'confirm_mins' => 30, 'grace_hours' => 24,
  'thresh' => 500_000, 'disabled' => [], 'pausedPairs' => [] }) unless File.exist?(File.join(DATA, 'config.json'))
%w[trades.json disputes.json ratings.json tickets.json ledger.json audit.json otp.json keys.json].each do |f|
  write_json(f, f == 'keys.json' ? {} : []) unless File.exist?(File.join(DATA, f))
end

def audit!(event)
  log = read_json('audit.json', [])
  log << { 'at' => Time.now.utc.iso8601, 'event' => event }
  write_json('audit.json', log.last(200))
end

def json_body(req)
  return {} if req.body.nil? || req.body.empty?
  JSON.parse(req.body)
rescue StandardError
  {}
end

# Twilio SMS delivery (global sender behind Better Auth phone OTP).
# Returns {sent:true} only on HTTP 2xx; otherwise honest fallback.
def twilio_send(to, text)
  sid = ENV['TWILIO_SID'].to_s
  token = ENV['TWILIO_TOKEN'].to_s
  from = ENV['TWILIO_FROM'].to_s
  return { sent: false, reason: 'no-key' } if sid.empty? || token.empty? || from.empty?
  uri = URI("https://api.twilio.com/2010-04-01/Accounts/#{sid}/Messages.json")
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.open_timeout = 10
  http.read_timeout = 15
  req = Net::HTTP::Post.new(uri.path)
  req.basic_auth(sid, token)
  req.set_form_data({ 'To' => to, 'From' => from, 'Body' => text })
  resp = http.request(req)
  { sent: resp.is_a?(Net::HTTPSuccess), status: resp.code.to_i, body: resp.body.to_s[0, 160] }
rescue StandardError => e
  { sent: false, reason: 'error', error: e.message.to_s[0, 120] }
end
# No key (or no network) => {sent:false} and callers fall back honestly.
def resend_send(to, subject, text)
  key = ENV['RESEND_API_KEY'].to_s
  return { sent: false, reason: 'no-key' } if key.empty?
  uri = URI('https://api.resend.com/emails')
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.open_timeout = 10
  http.read_timeout = 15
  req = Net::HTTP::Post.new(uri.path,
    { 'Authorization' => "Bearer #{key}", 'Content-Type' => 'application/json' })
  req.body = JSON.generate({
    from: ENV['RESEND_FROM'] || 'Trex <onboarding@resend.dev>',
    to: [to], subject: subject, text: text,
  })
  resp = http.request(req)
  { sent: resp.is_a?(Net::HTTPSuccess), status: resp.code.to_i, body: resp.body.to_s[0, 160] }
rescue StandardError => e
  { sent: false, reason: 'error', error: e.message.to_s[0, 120] }
end

# Trade email: sends when Resend is live, otherwise records the attempt in
# the audit log so nothing is silently "sent". Never raises.
def trade_email(trade, subject, text)
  to = trade['email'].to_s.strip
  return if to.empty?
  r = resend_send(to, subject, text)
  audit!("Email to #{to}: #{subject} (#{r[:sent] ? 'sent' : 'queued-no-key'})")
end

def send_json(res, obj, status = 200)
  res.status = status
  res['Content-Type'] = 'application/json'
  res['Access-Control-Allow-Origin'] = '*'
  res['Access-Control-Allow-Headers'] = 'Content-Type, X-Idempotency-Key'
  res.body = JSON.generate(obj)
end

def send_err(res, msg, status = 422)
  send_json(res, { 'ok' => false, 'error' => msg }, status)
end

# Idempotency: same key returns the stored response, never re-executes.
def idempotent(req, res)
  body = json_body(req)
  key = req['X-Idempotency-Key'] || body['idempotency_key']
  keys = read_json('keys.json', {})
  if key && keys[key]
    send_json(res, keys[key]['response'])
    return nil
  end
  result = yield body
  if key && result && result['ok']
    keys[key] = { 'response' => result, 'at' => Time.now.utc.iso8601 }
    write_json('keys.json', keys)
  end
  send_json(res, result)
end

server = WEBrick::HTTPServer.new(Port: PORT, AccessLog: [], Logger: WEBrick::Log.new(File::NULL))

server.mount_proc('/api') do |req, res|
  if req.request_method == 'OPTIONS'
    res.status = 200
    res['Access-Control-Allow-Origin'] = '*'
    res['Access-Control-Allow-Headers'] = 'Content-Type, X-Idempotency-Key'
    res['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    res.body = ''
    next
  end
  parts = req.path.sub(%r{^/api/?}, '').split('/').reject(&:empty?)
  begin
    case [req.request_method, parts[0]]
    when ['GET', 'health']
      send_json(res, { 'ok' => true, 'service' => 'trex-api', 'time' => Time.now.utc.iso8601 })

    when ['GET', 'integrations']
      send_json(res, { 'ok' => true,
        'resend' => !ENV['RESEND_API_KEY'].to_s.empty?,
        'sms' => !(ENV['TWILIO_SID'].to_s.empty? || ENV['TWILIO_TOKEN'].to_s.empty? || ENV['TWILIO_FROM'].to_s.empty?),
        'paystack' => !ENV['PAYSTACK_SECRET_KEY'].to_s.empty? })

    when ['POST', 'otp']
      b = json_body(req)
      target = (b['phone'] || b['email'] || '').to_s.strip
      if target.empty?
        send_err(res, 'Phone number or email is required.')
      else
        code = format('%06d', SecureRandom.random_number(1_000_000))
        otps = read_json('otp.json', [])
        otps.reject! { |o| o['target'] == target }
        otps << { 'target' => target, 'code' => code, 'exp' => Time.now.to_i + 600, 'attempts' => 0 }
        write_json('otp.json', otps)
        audit!("OTP requested for #{target}")
        if b['email'] && !b['email'].to_s.empty?
          # Real email path: the code is ONLY in the inbox, never in the response.
          r = resend_send(target, 'Your Trex code', "Your Trex code is #{code}. It expires in 10 minutes.")
          if r[:sent]
            send_json(res, { 'ok' => true, 'email_sent' => true, 'expires_in' => 600 })
          elsif r[:reason] == 'no-key'
            send_json(res, { 'ok' => true, 'demo_code' => code, 'expires_in' => 600, 'preview' => true })
          else
            send_json(res, { 'ok' => false, 'error' => 'Email failed to send — check the address and try again.' }, 502)
          end
        else
          # Phone path: real SMS when a global sender is configured, honest
          # preview code otherwise. Better Auth verifies either way.
          r = twilio_send(target, "Your Trex code is #{code}. It expires in 10 minutes.")
          if r[:sent]
            send_json(res, { 'ok' => true, 'sms_sent' => true, 'expires_in' => 600 })
          elsif r[:reason] == 'no-key'
            send_json(res, { 'ok' => true, 'demo_code' => code, 'expires_in' => 600, 'preview' => true })
          else
            send_json(res, { 'ok' => false, 'error' => 'SMS failed to send — check the number and try again.' }, 502)
          end
        end
      end

    when ['POST', 'verify']
      b = json_body(req)
      target = (b['phone'] || b['email'] || '').to_s.strip
      otps = read_json('otp.json', [])
      rec = otps.find { |o| o['target'] == target }
      if rec.nil? || Time.now.to_i > rec['exp']
        send_err(res, 'Code expired. Please request a new one.')
      elsif rec['attempts'].to_i >= 5
        send_err(res, 'Too many tries. Please request a new code.')
      elsif b['code'].to_s == rec['code']
        otps.reject! { |o| o['target'] == target }
        write_json('otp.json', otps)
        audit!("Verified #{target}")
        send_json(res, { 'ok' => true })
      else
        rec['attempts'] = rec['attempts'].to_i + 1
        write_json('otp.json', otps)
        send_err(res, 'That code doesn\'t match. Check and try again.')
      end

    when ['GET', 'offers']
      list = read_json('offers.json', [])
      live = req.query['all'] == '1' ? list : list.select { |o| o['live'] }
      send_json(res, { 'ok' => true, 'offers' => live })

    when ['POST', 'offers']
      b = json_body(req)
      list = read_json('offers.json', [])
      if b['id'] && b['delete']
        list.reject! { |x| x['id'] == b['id'] }
        write_json('offers.json', list)
        audit!("Offer deleted #{b['id']}")
        send_json(res, { 'ok' => true })
      elsif b['id']
        o = list.find { |x| x['id'] == b['id'] }
        if o.nil?
          send_err(res, 'Offer not found.', 404)
        else
          %w[rate min max methods terms avail live vendor].each { |k| o[k] = b[k] unless b[k].nil? }
          write_json('offers.json', list)
          audit!("Offer updated #{o['id']}")
          send_json(res, { 'ok' => true, 'offer' => o })
        end
      elsif b['provide'].to_s.empty? || b['want'].to_s.empty?
        send_err(res, 'Provide and want currencies are required.')
      elsif b['provide'] == b['want']
        send_err(res, 'Pick two different currencies.')
      elsif !b['rate'].to_f.positive?
        send_err(res, 'Set a rate above zero.')
      elsif !(b['max'].to_f > b['min'].to_f)
        send_err(res, 'Maximum must be above minimum.')
      else
        o = { 'id' => 'OFR-' + SecureRandom.hex(3).upcase, 'provide' => b['provide'], 'want' => b['want'],
              'rate' => b['rate'].to_f, 'min' => b['min'].to_f, 'max' => b['max'].to_f,
              'vendor' => b['vendor'] || 'You', 'country' => b['country'] || 'NG', 'tier' => 'Probation',
              'capacity' => (b['capacity'] || 5000).to_f, 'rating' => nil, 'trades' => 0,
              'methods' => b['methods'] || ['Bank transfer'], 'terms' => b['terms'] || '', 'live' => true }
        list << o
        write_json('offers.json', list)
        audit!("Offer published #{o['id']} #{o['provide']}->#{o['want']}")
        send_json(res, { 'ok' => true, 'offer' => o })
      end

    when ['POST', 'trades']
      idempotent(req, res) do |b|
        offers = read_json('offers.json', [])
        o = offers.find { |x| x['id'] == b['offer_id'] && x['live'] }
        next { 'ok' => false, 'error' => 'Offer unavailable.' } unless o
        amt = b['amount'].to_f
        if o['max'] && amt > o['max'] then next({ 'ok' => false, 'error' => "Above this offer's maximum (#{o['max']} #{o['provide']})." }) end
        if o['min'] && amt < o['min'] then next({ 'ok' => false, 'error' => "Below this offer's minimum (#{o['min']} #{o['provide']})." }) end
        bond = read_json('bond.json', {})
        reserved = bond['reserved'] || {}
        free = o['capacity'].to_f - reserved[o['id']].to_f
        if amt > free
          next({ 'ok' => false, 'error' => 'This offer cannot cover that amount right now.' })
        end
        reserved[o['id']] = reserved[o['id']].to_f + amt
        bond['reserved'] = reserved
        write_json('bond.json', bond)
        trades = read_json('trades.json', [])
        t = { 'id' => 'TXN-' + SecureRandom.hex(4).upcase, 'offer_id' => o['id'],
              'sell' => b['sell'], 'recv' => b['recv'], 'amount' => amt,
              'email' => b['email'].to_s.strip,
              'provide' => o['provide'], 'rate' => o['rate'], 'fee_pct' => read_json('config.json', {})['fee_pct'] || 1.5,
              'state' => 'opened', 'proof' => nil, 'chat' => [], 'created_at' => Time.now.utc.iso8601 }
        trades << t
        write_json('trades.json', trades)
        ledger = read_json('ledger.json', [])
        ledger << { 'id' => 'evt_' + SecureRandom.hex(6), 'kind' => 'reserve', 'trade' => t['id'],
                    'amount' => amt, 'ccy' => o['provide'], 'at' => Time.now.utc.iso8601 }
        write_json('ledger.json', ledger)
        audit!("Trade opened #{t['id']}")
        trade_email(t, "Your #{b['sell']}→#{b['recv']} trade is open",
          "Trade #{t['id']} for #{amt} #{b['sell']} is open and bond-protected. Reply to this email if you need help.")
        { 'ok' => true, 'trade' => t }
      end

    when ['GET', 'trades']
      send_json(res, { 'ok' => true, 'trades' => read_json('trades.json', []) })

    when ['POST', 'trade_action']
      idempotent(req, res) do |b|
        trades = read_json('trades.json', [])
        t = trades.find { |x| x['id'] == b['id'] }
        next({ 'ok' => false, 'error' => 'Trade not found.' }) unless t
        action = b['action'].to_s
        allowed = { 'opened' => %w[pay cancel], 'payment_sent' => %w[confirm dispute],
                    'payment_confirmed' => %w[deliver dispute], 'delivery_sent' => %w[complete dispute],
                    'disputed' => [], 'completed' => [], 'cancelled' => [] }
        unless (allowed[t['state']] || []).include?(action)
          next({ 'ok' => false, 'error' => "Cannot #{action} a #{t['state']} trade." })
        end
        if action == 'pay' && (b['proof'] || '').to_s.empty?
          next({ 'ok' => false, 'error' => 'Attach your payment receipt first.' })
        end
        t['state'] = { 'pay' => 'payment_sent', 'confirm' => 'payment_confirmed',
                       'deliver' => 'delivery_sent', 'complete' => 'completed',
                       'cancel' => 'cancelled', 'dispute' => 'disputed' }[action]
        t['proof'] = b['proof'] if b['proof']
        (t['chat'] ||= []) << { 'from' => b['from'] || 'you', 'text' => b['text'].to_s, 'at' => Time.now.utc.iso8601 } if b['text']
        if %w[completed cancelled].include?(t['state'])
          bond = read_json('bond.json', {})
          (bond['reserved'] ||= {})[t['offer_id']] = [(bond['reserved'][t['offer_id']].to_f - t['amount'].to_f), 0].max
          write_json('bond.json', bond)
          ledger = read_json('ledger.json', [])
          ledger << { 'id' => 'evt_' + SecureRandom.hex(6),
                      'kind' => t['state'] == 'completed' ? 'release' : 'refund',
                      'trade' => t['id'], 'amount' => t['amount'], 'ccy' => t['provide'], 'at' => Time.now.utc.iso8601 }
          write_json('ledger.json', ledger)
        end
        if t['state'] == 'disputed'
          disputes = read_json('disputes.json', [])
          disputes << { 'id' => 'DSP-' + SecureRandom.hex(3).upcase, 'trade' => t['id'], 'pair' => "#{t['sell']}-#{t['recv']}",
                        'amount' => t['amount'], 'cur' => t['sell'], 'vendor' => b['vendor'], 'proof' => t['proof'],
                        'rate' => t['rate'], 'method' => b['method'], 'chat' => (t['chat'] || []).map { |m| m['text'] }.join("\n"),
                        'state' => 'OPEN', 'at' => Time.now.utc.iso8601 }
          write_json('disputes.json', disputes)
        end
        write_json('trades.json', trades)
        audit!("Trade #{t['id']} → #{t['state']}")
        pair = "#{t['sell']}→#{t['recv']}"
        case t['state']
        when 'completed'
          trade_email(t, "Receipt #{t['id']} — your #{pair} trade is complete",
            "You sent #{t['amount']} #{t['sell']} and received #{t['recv']} at #{t['rate']}. Protection honoured. Ref #{t['id']}.")
        when 'disputed'
          trade_email(t, "Your #{pair} trade is under review",
            "Trade #{t['id']} is paused. Our team reviews the chat and receipts — usually within 24 hours.")
        when 'cancelled'
          trade_email(t, "Trade #{t['id']} cancelled", "Cancelled before payment. Nothing left your account.")
        end
        { 'ok' => true, 'trade' => t }
      end

    when ['GET', 'disputes']
      send_json(res, { 'ok' => true, 'disputes' => read_json('disputes.json', []) })

    when ['POST', 'resolve']
      idempotent(req, res) do |b|
        disputes = read_json('disputes.json', [])
        d = disputes.find { |x| x['id'] == b['id'] }
        next({ 'ok' => false, 'error' => 'Case not found.' }) unless d
        next({ 'ok' => false, 'error' => 'Already resolved.' }) unless d['state'] == 'OPEN'
        cfg = read_json('config.json', {})
        if d['amount'].to_f > (cfg['thresh'] || 500_000).to_f && !b['second_approval']
          next({ 'ok' => false, 'error' => 'Large amount — second approval required.', 'need_second' => true })
        end
        d['state'] = 'RESOLVED-' + b['how'].to_s
        d['resolved_at'] = Time.now.utc.iso8601
        write_json('disputes.json', disputes)
        trades = read_json('trades.json', [])
        t = trades.find { |x| x['id'] == d['trade'] }
        if t
          t['state'] = 'resolved'
          write_json('trades.json', trades)
          bond = read_json('bond.json', {})
          (bond['reserved'] ||= {})[t['offer_id']] = [(bond['reserved'][t['offer_id']].to_f - t['amount'].to_f), 0].max
          write_json('bond.json', bond)
          ledger = read_json('ledger.json', [])
          forfeit = b['how'] == 'VENDOR-AT-FAULT'
          # Reserve(-X) already holds the amount: release/refund (+X) nets to
          # zero; forfeit converts the hold into a permanent loss (0 entry).
          ledger << { 'id' => 'evt_' + SecureRandom.hex(6), 'kind' => forfeit ? 'forfeit' : 'release',
                      'trade' => t['id'], 'amount' => forfeit ? 0 : t['amount'], 'ccy' => t['provide'], 'at' => Time.now.utc.iso8601 }
          write_json('ledger.json', ledger)
        end
        audit!("Dispute #{d['id']} resolved #{b['how']}")
        if t
          trade_email(t, "Review complete — trade #{t['id']}",
            b['how'] == 'VENDOR-AT-FAULT' ? "Decided in your favour. Compensation comes from the vendor's bond." : "Decided: #{b['how']}. Details in your Trex history.")
        end
        { 'ok' => true, 'dispute' => d }
      end

    when ['GET', 'bond']
      bond = read_json('bond.json', {})
      send_json(res, { 'ok' => true, 'bond' => bond })

    when ['POST', 'bond']
      idempotent(req, res) do |b|
        bond = read_json('bond.json', {})
        op = b['op'].to_s
        ccy = b['ccy'].to_s
        amt = b['amount'].to_f
        bond['caps'] ||= {}
        case op
        when 'topup'
          next({ 'ok' => false, 'error' => 'Amount must be above zero.' }) unless amt.positive?
          bond['caps'][ccy] = bond['caps'][ccy].to_f + amt
          ledger = read_json('ledger.json', [])
          ledger << { 'id' => 'evt_' + SecureRandom.hex(6), 'kind' => 'topup', 'trade' => nil, 'amount' => amt, 'ccy' => ccy, 'at' => Time.now.utc.iso8601 }
          write_json('ledger.json', ledger)
        when 'release'
          free = bond['caps'][ccy].to_f - (bond['reserved'] || {})[ccy].to_f
          busy = (bond['reserved'] || {}).values.map(&:to_f).sum.positive?
          next({ 'ok' => false, 'error' => 'Withdrawals need zero open trades.' }) if busy
          next({ 'ok' => false, 'error' => 'That exceeds your free balance.' }) if amt > free || !amt.positive?
          if amt > 5000 && !b['second_approval']
            next({ 'ok' => false, 'error' => 'Large amount — second approval required.', 'need_second' => true })
          end
          bond['caps'][ccy] = bond['caps'][ccy].to_f - amt
          ledger = read_json('ledger.json', [])
          ledger << { 'id' => 'evt_' + SecureRandom.hex(6), 'kind' => 'release', 'trade' => nil, 'amount' => amt, 'ccy' => ccy, 'at' => Time.now.utc.iso8601 }
          write_json('ledger.json', ledger)
        when 'switch'
          # Removed 2 Oct 2026 (decision 17): per-trade 50% is the only model.
          next({ 'ok' => false, 'error' => 'Trex uses one bond model: 50% per trade. Nothing to switch.' })
        else
          next({ 'ok' => false, 'error' => 'Unknown bond operation.' })
        end
        write_json('bond.json', bond)
        audit!("Bond #{op} #{amt} #{ccy}")
        { 'ok' => true, 'bond' => bond }
      end

    when ['GET', 'config']
      send_json(res, { 'ok' => true, 'config' => read_json('config.json', {}) })

    when ['POST', 'config']
      b = json_body(req)
      cfg = read_json('config.json', {})
      %w[fee_pct confirm_mins grace_hours thresh].each { |k| cfg[k] = b[k] unless b[k].nil? }
      cfg['disabled'] = b['disabled'] if b['disabled']
      cfg['pausedPairs'] = b['pausedPairs'] if b['pausedPairs']
      write_json('config.json', cfg)
      audit!('Settings updated')
      send_json(res, { 'ok' => true, 'config' => cfg })

    when ['GET', 'ledger']
      send_json(res, { 'ok' => true, 'ledger' => read_json('ledger.json', []) })

    when ['GET', 'ratings']
      send_json(res, { 'ok' => true, 'ratings' => read_json('ratings.json', []) })

    when ['POST', 'ratings']
      b = json_body(req)
      r = read_json('ratings.json', [])
      r << { 'trade' => b['trade'], 'rating' => b['rating'], 'at' => Time.now.utc.iso8601 }
      write_json('ratings.json', r)
      send_json(res, { 'ok' => true })

    when ['GET', 'tickets']
      send_json(res, { 'ok' => true, 'tickets' => read_json('tickets.json', []) })

    when ['POST', 'tickets']
      b = json_body(req)
      return send_err(res, 'Describe the issue first.') if b['title'].to_s.empty?
      t = read_json('tickets.json', [])
      t << { 'id' => 'TCK-' + SecureRandom.hex(3).upcase, 'cat' => b['cat'] || 'General', 'title' => b['title'], 'at' => Time.now.utc.iso8601 }
      write_json('tickets.json', t)
      audit!('Ticket opened')
      send_json(res, { 'ok' => true })

    when ['GET', 'audit']
      send_json(res, { 'ok' => true, 'audit' => read_json('audit.json', []) })

    else
      send_err(res, 'Unknown endpoint.', 404)
    end
  rescue StandardError => e
    send_err(res, 'Server error — please retry.', 500)
  end
end

# Static files for everything else
server.mount('/', WEBrick::HTTPServlet::FileHandler, ROOT)

trap('INT') { server.shutdown }
puts "Trex API live on http://localhost:#{PORT}/  (data in ./data/)"
server.start
